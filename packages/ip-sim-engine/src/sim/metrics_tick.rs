//! Tick metrics — matches `packages/sim-core/src/metrics.ts` (`computeTickMetrics`, etc.).

use std::collections::HashMap;

use crate::sim::types::{
    Agent, Edge, TickMetrics, WorldState,
};

pub fn gini(values: &[f64]) -> f64 {
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len() as f64;
    let sum: f64 = v.iter().sum();
    if sum == 0.0 {
        return 0.0;
    }
    let mut num = 0.0;
    for (i, val) in v.iter().enumerate() {
        num += (2.0 * i as f64 - n + 1.0) * val;
    }
    num / (n * sum)
}

pub fn hhi(shares: &[f64]) -> f64 {
    let s: f64 = shares.iter().sum();
    if s == 0.0 {
        return 0.0;
    }
    shares.iter().map(|x| {
        let p = x / s;
        p * p
    }).sum()
}

pub struct StockDistribution {
    pub total: f64,
    pub top10_sum: f64,
    pub top1_sum: f64,
    pub gini: f64,
    pub top10_share: f64,
}

pub fn stock_distribution(values: &[f64]) -> StockDistribution {
    let total: f64 = values.iter().sum();
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let n = sorted.len();
    let k10 = ((n as f64 * 0.1).ceil() as usize).max(1);
    let k1 = if n == 0 {
        0
    } else {
        ((n as f64 * 0.01).ceil() as usize).max(1)
    };
    let top10_sum: f64 = sorted.iter().take(k10).sum();
    let top1_sum: f64 = if n == 0 {
        0.0
    } else {
        sorted.iter().take(k1).sum()
    };
    StockDistribution {
        total,
        top10_sum,
        top1_sum,
        gini: gini(values),
        top10_share: if total > 0.0 { top10_sum / total } else { 0.0 },
    }
}

fn neighbor_counts(agents: &[Agent], edges: &[Edge]) -> HashMap<String, u32> {
    let mut d: HashMap<String, u32> = HashMap::new();
    for a in agents {
        d.insert(a.id.clone(), 0);
    }
    for e in edges {
        *d.entry(e.a.clone()).or_insert(0) += 1;
        *d.entry(e.b.clone()).or_insert(0) += 1;
    }
    d
}

fn spillover_from_graph(
    id: &str,
    edges: &[Edge],
    agents: &[Agent],
    alpha: f64,
) -> f64 {
    let mut acc: HashMap<String, f64> = HashMap::new();
    for e in edges {
        if e.a == id {
            *acc.entry(e.b.clone()).or_insert(0.0) += e.weight;
        } else if e.b == id {
            *acc.entry(e.a.clone()).or_insert(0.0) += e.weight;
        }
    }
    let mut by_id: HashMap<String, &Agent> = HashMap::new();
    for a in agents {
        by_id.insert(a.id.clone(), a);
    }
    let mut s = 0.0;
    for (nid, w) in acc {
        if let Some(o) = by_id.get(&nid) {
            s += w * o.knowledge;
        }
    }
    alpha * s
}

pub fn compute_market_shares(
    agents: &[Agent],
    edges: &[Edge],
    type_weights: &[f64; 4],
    capability_beta: f64,
    spillover_alpha: f64,
) -> Vec<f64> {
    let deg = neighbor_counts(agents, edges);
    agents
        .iter()
        .map(|ag| {
            let spill = spillover_from_graph(&ag.id, edges, agents, spillover_alpha);
            let cap = (ag.knowledge + spill).max(1e-9).powf(capability_beta);
            let patent_boost = 1.0 + 0.12 * (ag.patent_expires_at.len() as f64);
            let rep = 1.0 + 0.05 * ag.reputation;
            let tw = type_weights[ag.kind as usize];
            let di = *deg.get(&ag.id).unwrap_or(&0) as f64;
            let w = tw * cap * patent_boost * rep * (1.0 + 0.02 * di);
            w.max(1e-6)
        })
        .collect()
}

pub fn compute_tick_metrics(world: &WorldState, innovation_flow: f64) -> TickMetrics {
    let agents = &world.agents;
    let wealth: Vec<f64> = agents.iter().map(|a| a.wealth).collect();
    let rep_vals: Vec<f64> = agents.iter().map(|a| a.reputation).collect();
    let w_dist = stock_distribution(&wealth);
    let r_dist = stock_distribution(&rep_vals);
    let shares = compute_market_shares(
        agents,
        &world.edges,
        &world.config.type_weights,
        world.config.capability_beta,
        world.config.spillover_alpha,
    );
    let ms_hhi = hhi(&shares);
    let patent_vals: Vec<f64> = agents
        .iter()
        .map(|a| a.patent_expires_at.len() as f64)
        .collect();
    let patent_hhi = hhi(
        &patent_vals
            .iter()
            .map(|x| x + 1e-6)
            .collect::<Vec<_>>(),
    );
    let deg = neighbor_counts(agents, &world.edges);
    let deg_vals: Vec<f64> = agents
        .iter()
        .map(|a| *deg.get(&a.id).unwrap_or(&0) as f64)
        .collect();
    let deg_hhi = hhi(
        &deg_vals
            .iter()
            .map(|x| x + 1e-6)
            .collect::<Vec<_>>(),
    );
    let sum_shares: f64 = shares.iter().sum::<f64>().max(1e-30);
    let sum_pat: f64 = patent_vals.iter().map(|x| x + 1e-3).sum::<f64>().max(1e-30);
    let sum_deg: f64 = deg_vals.iter().map(|x| x + 1e-3).sum::<f64>().max(1e-30);
    let power_scores: Vec<f64> = agents
        .iter()
        .enumerate()
        .map(|(i, _)| {
            let ms = shares[i] / sum_shares;
            let p_pat = (patent_vals[i] + 1e-3) / sum_pat;
            let p_deg = (deg_vals[i] + 1e-3) / sum_deg;
            0.45 * ms + 0.35 * p_pat + 0.2 * p_deg
        })
        .collect();
    let power_hhi = hhi(&power_scores);
    let total_k: f64 = agents.iter().map(|a| a.knowledge).sum();
    let lr = &world.last_regulatory_tick;
    let n_agents = agents.len().max(1) as f64;
    let mean_wealth = w_dist.total / n_agents;
    TickMetrics {
        tick: world.tick,
        total_wealth: w_dist.total,
        mean_wealth,
        top10_wealth: w_dist.top10_sum,
        top1_percent_wealth: w_dist.top1_sum,
        gini_wealth: w_dist.gini,
        top10_wealth_share: w_dist.top10_share,
        total_reputation: r_dist.total,
        top10_reputation: r_dist.top10_sum,
        top1_percent_reputation: r_dist.top1_sum,
        gini_reputation: r_dist.gini,
        top10_reputation_share: r_dist.top10_share,
        hhi_market_share: ms_hhi,
        innovation_flow,
        total_knowledge_stock: total_k,
        global_pool: world.global_pool,
        power_hhi,
        power_components_market_share_hhi: ms_hhi,
        power_components_patent_hhi: patent_hhi,
        power_components_degree_hhi: deg_hhi,
        regulatory_stringency: lr.as_ref().map(|x| x.effective_stringency).unwrap_or(0.0),
        regulatory_corruption: world.regulatory.corruption,
        externality_net_load: lr.as_ref().map(|x| x.net_social_load).unwrap_or(0.0),
        externality_mitigated_load: lr.as_ref().map(|x| x.mitigated_load).unwrap_or(0.0),
        externality_wealth_transfer: lr.as_ref().map(|x| x.total_wealth_transfer).unwrap_or(0.0),
        agent_count: agents.len(),
    }
}
