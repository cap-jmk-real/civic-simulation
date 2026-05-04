//! Market demand: **edge logit** (default) vs **contest legacy** — see `packages/sim-core/SIMULATION_MATH.md` §5.

use std::collections::{HashMap, HashSet};

use crate::rng::Rng01;
use crate::sim::types::{Agent, DemandModel, Edge, PatentRegime, SimConfig};

fn regime_patent_mult(regime: &PatentRegime) -> f64 {
    match regime {
        PatentRegime::Strong => 1.35,
        PatentRegime::Weak => 1.12,
        PatentRegime::None => 1.0,
    }
}

fn softmax_probs(utilities: &[f64], tau: f64) -> Vec<f64> {
    let t = tau.max(1e-9);
    let mx = utilities.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = utilities.iter().map(|u| ((u - mx) / t).exp()).collect();
    let s: f64 = exps.iter().sum::<f64>().max(1e-30);
    exps.iter().map(|e| e / s).collect()
}

fn build_adj(agents: &[Agent], edges: &[Edge]) -> HashMap<String, Vec<(String, f64)>> {
    let mut m: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for a in agents {
        m.insert(a.id.clone(), Vec::new());
    }
    for e in edges {
        if e.a == e.b {
            continue;
        }
        m.entry(e.a.clone())
            .or_default()
            .push((e.b.clone(), e.weight));
        m.entry(e.b.clone())
            .or_default()
            .push((e.a.clone(), e.weight));
    }
    m
}

fn contest_legacy_base_revenues<R: Rng01 + ?Sized>(
    agents: &[Agent],
    market_size: f64,
    global_pool: f64,
    shares: &[f64],
    sum_w: f64,
    patent_regime: &PatentRegime,
    regime_pm: f64,
    rnd: &mut R,
) -> Vec<f64> {
    let n = agents.len();
    let mut out = vec![0.0; n];
    for i in 0..n {
        let ag = &agents[i];
        let share = shares[i] / sum_w;
        let mut base_rev = share * market_size;
        let license = ag.patent_expires_at.len() as f64
            * (5.0 + rnd.next_f64() * 4.0)
            * regime_pm
            * if matches!(patent_regime, PatentRegime::None) {
                0.0
            } else {
                1.0
            };
        base_rev += license;
        if matches!(patent_regime, PatentRegime::None) {
            base_rev *= 0.92 + global_pool * 0.0015;
        }
        out[i] = base_rev;
    }
    out
}

fn edge_logit_base_revenues<R: Rng01 + ?Sized>(
    agents: &[Agent],
    edges: &[Edge],
    cfg: &SimConfig,
    market_size: f64,
    global_pool: f64,
    shares: &[f64],
    sum_w: f64,
    qualities: &[f64],
    patent_regime: &PatentRegime,
    regime_pm: f64,
    rnd: &mut R,
) -> Vec<f64> {
    let n = agents.len();
    if n == 0 {
        return Vec::new();
    }

    let id_to_idx: HashMap<String, usize> = agents
        .iter()
        .enumerate()
        .map(|(i, a)| (a.id.clone(), i))
        .collect();
    let adj = build_adj(agents, edges);
    let mut incoming = vec![0.0; n];

    let tau = cfg.edge_logit_temperature;
    let uq = cfg.edge_logit_utility_quality;
    let ur = cfg.edge_logit_utility_reputation;
    let uk = cfg.edge_logit_utility_knowledge;
    let ew = cfg.edge_logit_edge_weight_scale;
    let pn = cfg.edge_logit_preference_noise;

    for i in 0..n {
        let ai = &agents[i];
        let bi = market_size * (shares[i] / sum_w);
        let nbs = adj.get(&ai.id).cloned().unwrap_or_default();

        let mut candidates: Vec<usize> = vec![i];
        let mut seen = HashSet::new();
        seen.insert(i);
        for (nid, _) in &nbs {
            if let Some(&j) = id_to_idx.get(nid) {
                if seen.insert(j) {
                    candidates.push(j);
                }
            }
        }

        let utilities: Vec<f64> = candidates
            .iter()
            .map(|&j| {
                let ag = &agents[j];
                let q = qualities[j];
                let mut u = uq * (q + 1e-9).ln()
                    + ur * ag.reputation
                    + uk * (ag.knowledge + 1e-9).ln();
                if j != i {
                    let ww = nbs
                        .iter()
                        .find(|(id, _)| *id == ag.id)
                        .map(|(_, w)| *w)
                        .unwrap_or(1.0);
                    u *= 1.0 + ww * ew;
                }
                if pn > 0.0 {
                    u += (rnd.next_f64() - 0.5) * 2.0 * pn;
                }
                u
            })
            .collect();

        let probs = softmax_probs(&utilities, tau);
        for (k, &j) in candidates.iter().enumerate() {
            incoming[j] += bi * probs[k];
        }
    }

    incoming
        .into_iter()
        .enumerate()
        .map(|(j, r)| {
            let ag = &agents[j];
            let license = ag.patent_expires_at.len() as f64
                * (5.0 + rnd.next_f64() * 4.0)
                * regime_pm
                * if matches!(patent_regime, PatentRegime::None) {
                    0.0
                } else {
                    1.0
                };
            let mut b = r + license;
            if matches!(patent_regime, PatentRegime::None) {
                b *= 0.92 + global_pool * 0.0015;
            }
            b
        })
        .collect()
}

/// Per-agent base revenue before CES scaling (matches `packages/sim-core/src/demand.ts`).
pub fn compute_base_revenues<R: Rng01 + ?Sized>(
    agents: &[Agent],
    edges: &[Edge],
    cfg: &SimConfig,
    market_size: f64,
    global_pool: f64,
    shares: &[f64],
    sum_w: f64,
    qualities: &[f64],
    patent_regime: &PatentRegime,
    rnd: &mut R,
) -> Vec<f64> {
    let regime_pm = regime_patent_mult(patent_regime);
    match cfg.demand_model {
        DemandModel::ContestLegacy => contest_legacy_base_revenues(
            agents,
            market_size,
            global_pool,
            shares,
            sum_w,
            patent_regime,
            regime_pm,
            rnd,
        ),
        DemandModel::EdgeLogit => edge_logit_base_revenues(
            agents,
            edges,
            cfg,
            market_size,
            global_pool,
            shares,
            sum_w,
            qualities,
            patent_regime,
            regime_pm,
            rnd,
        ),
    }
}
