//! Matches `packages/sim-core/src/policies/heuristic.ts`.

use crate::sim::observe::{build_observation, Observation};
use crate::sim::types::{Agent, AgentKind, WorldState};

pub fn rnd_det(id: &str, tick: i32) -> f64 {
    let sum: i32 = id.chars().map(|c| c as u32 as i32).sum();
    let mut h: i32 = ((tick as i64)
        .wrapping_mul(2654435761_i64)
        .wrapping_add(sum as i64)) as i32;
    h ^= h << 13;
    h ^= ((h as u32) >> 7) as i32;
    h ^= h << 17;
    (h as u32 as f64) / 4294967296.0
}

#[cfg(test)]
mod rnd_tests {
    use super::*;

    #[test]
    fn rnd_det_matches_ts_bigco() {
        assert!((rnd_det("bigco-1", 0) - 0.7089974223636091).abs() < 1e-12);
        assert!((rnd_det("bigco-1", 1) - 0.6132882933598012).abs() < 1e-12);
    }
}

pub fn heuristic_policy(agent: &Agent, world: &WorldState) -> &'static str {
    let o = build_observation(agent, world);
    let low_cash = o.wealth < 25.0;

    match agent.kind {
        AgentKind::Academic => {
            if o.open_science_subsidy > 0.25 && !low_cash {
                return "publish_open";
            }
            if rnd_det(&agent.id, world.tick as i32) < 0.35 {
                return "invest_rnd";
            }
            "publish_open"
        }
        AgentKind::Bigco => heuristic_bigco(agent, world, &o),
        AgentKind::Smb => heuristic_smb(agent, world, &o),
        AgentKind::Solo => heuristic_solo(agent, world, &o, low_cash),
    }
}

fn heuristic_bigco(agent: &Agent, world: &WorldState, o: &Observation) -> &'static str {
    let p = &world.config.policy;
    if o.spawn_enabled && o.spawn_can_afford && !o.spawn_at_cap && o.wealth > 90.0
        && rnd_det(&agent.id, world.tick as i32 + 19) < 0.06
    {
        return "spawn_agent";
    }
    if o.regulatory_enabled && world.config.regulatory.bribe.enabled && o.wealth > 55.0
        && rnd_det(&agent.id, world.tick as i32 + 11) < 0.08
    {
        return "bribe_regulator";
    }
    if !o.patent_regime_none && o.patent_count < 3 && o.wealth > 40.0
        && rnd_det(&agent.id, world.tick as i32) < 0.22
    {
        return "file_patent";
    }
    if rnd_det(&agent.id, world.tick as i32 + 1) < 0.45 {
        return "invest_rnd";
    }
    if p.enforcement_intensity > 0.4 && o.reputation > 1.3
        && rnd_det(&agent.id, world.tick as i32 + 2) < 0.15
    {
        return "enforce_ip";
    }
    if p.enforcement_intensity > 0.4 && rnd_det(&agent.id, world.tick as i32 + 2) < 0.12 {
        return "enforce_ip";
    }
    "idle"
}

fn heuristic_smb(agent: &Agent, world: &WorldState, o: &Observation) -> &'static str {
    let low_cash = o.wealth < 25.0;
    if o.spawn_enabled && o.spawn_can_afford && !o.spawn_at_cap && o.wealth > 70.0
        && rnd_det(&agent.id, world.tick as i32 + 18) < 0.07
    {
        return "spawn_agent";
    }
    if o.regulatory_enabled && world.config.regulatory.bribe.enabled && o.wealth > 45.0
        && rnd_det(&agent.id, world.tick as i32 + 12) < 0.05
    {
        return "bribe_regulator";
    }
    if !low_cash && o.neighbors_len > 0 && rnd_det(&agent.id, world.tick as i32 + 8) < 0.12 {
        return "trade";
    }
    if !low_cash && rnd_det(&agent.id, world.tick as i32) < 0.25 {
        return "collaborate";
    }
    if rnd_det(&agent.id, world.tick as i32 + 3) < 0.55 {
        "invest_rnd"
    } else {
        "idle"
    }
}

fn heuristic_solo(agent: &Agent, world: &WorldState, o: &Observation, low_cash: bool) -> &'static str {
    if !low_cash && o.neighbors_len > 0 && rnd_det(&agent.id, world.tick as i32 + 9) < 0.14 {
        return "trade";
    }
    if !low_cash && rnd_det(&agent.id, world.tick as i32) < 0.3 {
        return "collaborate";
    }
    if rnd_det(&agent.id, world.tick as i32 + 4) < 0.6 {
        "invest_rnd"
    } else {
        "publish_open"
    }
}
