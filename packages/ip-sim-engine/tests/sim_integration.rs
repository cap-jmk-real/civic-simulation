//! Rust simulation parity smoke tests (aligned with `packages/sim-core` integration tests).

use std::collections::HashMap;

use ip_sim_engine::sim::types::DemandModel;
use ip_sim_engine::sim::{
    apply_step, create_world, default_sim_config, run_simulation_sync_heuristic,
};
use ip_sim_engine::sim::rng_util::tick_rng;

#[test]
fn heuristic_run_history_length_equals_ticks() {
    let mut c = default_sim_config();
    c.ticks = 7;
    c.agent_counts = [2, 1, 0, 0];
    let run = run_simulation_sync_heuristic(c);
    assert_eq!(run.history.len(), 7);
    assert_eq!(run.final_world.config.ticks, 7);
}

#[test]
fn zero_agents_runs_without_panic() {
    let mut c = default_sim_config();
    c.agent_counts = [0, 0, 0, 0];
    c.ticks = 3;
    c.seed = 1;
    let run = run_simulation_sync_heuristic(c);
    assert_eq!(run.history.len(), 3);
    assert!(run.final_world.agents.is_empty());
}

#[test]
fn snapshots_align_with_final_wealth_after_last_tick() {
    let mut c = default_sim_config();
    c.ticks = 5;
    c.agent_counts = [1, 1, 0, 0];
    let run = run_simulation_sync_heuristic(c);
    let last = run.history.last().expect("history");
    let by_snap: HashMap<_, _> = last
        .agent_snapshots
        .iter()
        .map(|s| (s.id.clone(), s.wealth))
        .collect();
    for ag in &run.final_world.agents {
        let w_snap = *by_snap.get(&ag.id).expect("snapshot id");
        assert!(
            (w_snap - ag.wealth).abs() < 1e-8,
            "id {} snap {} final {}",
            ag.id,
            w_snap,
            ag.wealth
        );
    }
}

#[test]
fn each_tick_record_includes_edges_array() {
    let mut c = default_sim_config();
    c.ticks = 2;
    let run = run_simulation_sync_heuristic(c);
    assert_eq!(run.history.len(), 2);
    for h in &run.history {
        for e in &h.edges {
            assert!(!e.a.is_empty() && !e.b.is_empty());
        }
    }
    if let Some(last) = run.history.last() {
        assert_eq!(last.edges.len(), run.final_world.edges.len());
    }
}

#[test]
fn create_world_initializes_tick_at_zero() {
    let w = create_world(default_sim_config());
    assert_eq!(w.tick, 0);
}

/// Gold: keep final-tick innovation flow aligned with `packages/sim-core/src/innovation_flow_golden.test.ts`.
#[test]
fn final_tick_innovation_flow_matches_ts_gold() {
    let mut c = default_sim_config();
    c.seed = 42;
    c.ticks = 30;
    c.agent_counts = [2, 2, 2, 2];
    let run = run_simulation_sync_heuristic(c);
    let last = run.history.last().expect("history");
    let flow = last.metrics.innovation_flow;
    assert!(flow > 5.0, "innovation_flow {}", flow);
    assert!(
        (flow - 34.63692426215857).abs() < 1e-9,
        "expected TS gold 34.63692426215857, got {}",
        flow
    );
}

#[test]
fn idle_tick_updates_wealth_deterministically() {
    let mut c = default_sim_config();
    // Golden value matches TypeScript contest-pool revenue split (`demandModel: contest_legacy`).
    c.demand_model = DemandModel::ContestLegacy;
    c.agent_counts = [1, 1, 0, 0];
    c.ticks = 1;
    let seed = c.seed;
    let mut world = create_world(c);
    let mut actions = HashMap::new();
    for a in &world.agents {
        actions.insert(a.id.clone(), "idle".to_string());
    }
    let mut rnd = tick_rng(seed, 0, world.tick);
    apply_step(&mut world, &actions, &mut rnd);
    let w0 = world.agents[0].wealth;
    // Reference from TypeScript market + revenue path (seed 42, 2 agents).
    assert!((w0 - 345.35212318537356).abs() < 1e-6, "wealth {}", w0);
}
