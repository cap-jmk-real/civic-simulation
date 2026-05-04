//! Matches `packages/sim-core/src/regulatory.rs`.

use crate::sim::production::offering_quality_branches;
use crate::sim::types::{Agent, RegulatoryRuleMode, SimConfig, WorldState};

pub fn clamp01(x: f64) -> f64 {
    x.max(0.0).min(1.0)
}

pub fn effective_stringency_from_state(
    stringency: f64,
    corruption: f64,
    corruption_erodes: f64,
) -> f64 {
    clamp01(stringency * (1.0 - corruption * corruption_erodes))
}

pub struct NetLoad {
    pub goods_channel: f64,
    pub services_channel: f64,
    pub net_load: f64,
}

pub fn compute_net_externality_load(agents: &[Agent], cfg: &SimConfig) -> NetLoad {
    let reg = &cfg.regulatory;
    let mut goods_channel = 0.0;
    let mut services_channel = 0.0;
    for ag in agents {
        let b = offering_quality_branches(ag.kind, ag.knowledge, ag.labor, cfg);
        let i = ag.kind as usize;
        let gp = reg.goods_externality_by_producer[i];
        let sp = reg.services_externality_by_producer[i];
        goods_channel += b.q_good * gp;
        services_channel += b.q_serv * sp;
    }
    NetLoad {
        goods_channel,
        services_channel,
        net_load: goods_channel + services_channel,
    }
}

pub fn mitigation_baseline_stringency(world: &WorldState, cfg: &SimConfig) -> f64 {
    let reg = &cfg.regulatory;
    let ambition = clamp01(cfg.policy.regulatory_ambition);
    let erosion = reg.bribe.corruption_erodes_stringency;
    let corrupt_erosion = world.regulatory.corruption * erosion;
    if matches!(reg.rule_mode, RegulatoryRuleMode::Fixed) {
        return clamp01(
            reg.base_stringency * (0.2 + 0.8 * ambition) * reg.policy_scale
                * (1.0 - corrupt_erosion),
        );
    }
    effective_stringency_from_state(
        world.regulatory.stringency,
        world.regulatory.corruption,
        erosion,
    )
}

pub fn advance_regulatory_stringency(world: &mut WorldState, cfg: &SimConfig, rnd: &mut impl FnMut() -> f64) {
    let reg = &cfg.regulatory;
    if !reg.enabled {
        return;
    }
    let ambition = clamp01(cfg.policy.regulatory_ambition);
    let corrupt_erosion =
        world.regulatory.corruption * reg.bribe.corruption_erodes_stringency;
    if matches!(reg.rule_mode, RegulatoryRuleMode::Fixed) {
        world.regulatory.stringency = clamp01(
            reg.base_stringency * (0.2 + 0.8 * ambition) * reg.policy_scale
                * (1.0 - corrupt_erosion),
        );
        return;
    }
    let attractor = clamp01(
        reg.base_stringency * (0.2 + 0.8 * ambition) * reg.policy_scale * (1.0 - corrupt_erosion),
    );
    let noise = (rnd() - 0.5) * 2.0 * reg.dynamic_noise;
    world.regulatory.stringency = clamp01(
        world.regulatory.stringency * reg.dynamic_persistence
            + (1.0 - reg.dynamic_persistence) * attractor
            + noise,
    );
}
