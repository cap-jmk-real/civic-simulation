//! Matches `packages/sim-core/src/production.ts`.

use crate::sim::types::{AgentKind, SimConfig};

const EPS: f64 = 1e-9;

pub fn ces_aggregate(
    knowledge: f64,
    labor: f64,
    alpha: f64,
    rho: f64,
    scale: f64,
) -> f64 {
    let k = knowledge.max(EPS);
    let l = labor.max(EPS);
    let a = alpha.clamp(0.0, 1.0);
    let r = rho;
    if r.abs() < 1e-10 {
        return scale * k.powf(a) * l.powf(1.0 - a);
    }
    let inner = a * k.powf(r) + (1.0 - a) * l.powf(r);
    scale * inner.max(EPS).powf(1.0 / r)
}

pub fn service_labor_share(kind: AgentKind) -> f64 {
    match kind {
        AgentKind::Academic => 0.72,
        AgentKind::Solo => 0.55,
        AgentKind::Smb => 0.42,
        AgentKind::Bigco => 0.28,
    }
}

pub struct BranchQuality {
    pub q_good: f64,
    pub q_serv: f64,
    pub q: f64,
}

pub fn offering_quality_branches(
    kind: AgentKind,
    knowledge: f64,
    labor: f64,
    cfg: &SimConfig,
) -> BranchQuality {
    if !cfg.ces_quality_enabled {
        return BranchQuality {
            q_good: 1.0,
            q_serv: 1.0,
            q: 1.0,
        };
    }
    let s = service_labor_share(kind);
    let l = labor.max(0.0);
    let lg = l * (1.0 - s);
    let ls = l * s;
    let q_good = ces_aggregate(
        knowledge,
        lg,
        cfg.ces_alpha_knowledge,
        cfg.ces_rho,
        cfg.ces_scale,
    );
    let q_serv = ces_aggregate(
        knowledge,
        ls,
        cfg.ces_alpha_knowledge,
        cfg.ces_rho,
        cfg.ces_scale,
    );
    let q = cfg.ces_mix_goods * q_good + (1.0 - cfg.ces_mix_goods) * q_serv;
    BranchQuality {
        q_good,
        q_serv,
        q,
    }
}
