//! Matches `packages/sim-core/src/observe.ts` (fields used by heuristic).

use crate::sim::regulatory::effective_stringency_from_state;
use crate::sim::types::{Agent, WorldState};

pub struct Observation {
    pub wealth: f64,
    pub patent_count: usize,
    pub reputation: f64,
    pub neighbors_len: usize,
    pub open_science_subsidy: f64,
    pub patent_regime_none: bool,
    pub enforcement_intensity: f64,
    pub spawn_enabled: bool,
    pub spawn_max: u32,
    pub spawn_at_cap: bool,
    pub spawn_can_afford: bool,
    pub regulatory_enabled: bool,
    pub bribe_enabled: bool,
}

pub fn build_observation(agent: &Agent, world: &WorldState) -> Observation {
    let mut neighbors_len = 0usize;
    for e in &world.edges {
        if e.a == agent.id || e.b == agent.id {
            neighbors_len += 1;
        }
    }
    let reg = &world.config.regulatory;
    let erosion = reg.bribe.corruption_erodes_stringency;
    let eff = if reg.enabled {
        effective_stringency_from_state(
            world.regulatory.stringency,
            world.regulatory.corruption,
            erosion,
        )
    } else {
        0.0
    };
    let _ = eff; // same as TS effectiveStringency in observation
    let sp = &world.config.spawn;
    let pop = world.agents.len() as u32;
    let need = sp.parent_cost_wealth + sp.min_parent_wealth_floor;
    Observation {
        wealth: agent.wealth,
        patent_count: agent.patent_expires_at.len(),
        reputation: agent.reputation,
        neighbors_len,
        open_science_subsidy: world.config.policy.open_science_subsidy,
        patent_regime_none: matches!(world.config.policy.patent_regime, super::types::PatentRegime::None),
        enforcement_intensity: world.config.policy.enforcement_intensity,
        spawn_enabled: sp.enabled,
        spawn_max: sp.max_agents,
        spawn_at_cap: pop >= sp.max_agents,
        spawn_can_afford: sp.enabled && pop < sp.max_agents && agent.wealth >= need,
        regulatory_enabled: reg.enabled,
        bribe_enabled: reg.bribe.enabled,
    }
}
