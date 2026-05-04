//! Parity with `packages/sim-core/src/engine.spawn.test.ts`.

use std::collections::HashMap;

use ip_sim_engine::sim::types::{AgentKind, SimConfig};
use ip_sim_engine::sim::{apply_step, create_world, default_sim_config};
use ip_sim_engine::ConstantRng;

fn spawn_success_cfg() -> SimConfig {
    let mut c = default_sim_config();
    c.agent_counts = [1, 0, 0, 0];
    c.spawn.enabled = true;
    c.spawn.max_agents = 500;
    c.spawn.parent_cost_wealth = 10.0;
    c.spawn.min_parent_wealth_floor = 5.0;
    c.spawn.inherit_knowledge_fraction = 0.5;
    c.spawn.child_type_inherit = true;
    c.spawn.child_start_wealth = 30.0;
    c.spawn.link_parent_edge_weight = 0.5;
    c.spawn.parent_reputation_on_success = 0.02;
    c
}

#[test]
fn spawn_adds_agent_when_enabled_and_affordable() {
    let c = spawn_success_cfg();
    let mut world = create_world(c);
    let parent_id = world.agents[0].id.clone();
    world.agents[0].wealth = 200.0;
    world.agents[0].knowledge = 40.0;
    let n0 = world.agents.len();
    let mut actions = HashMap::new();
    actions.insert(parent_id.clone(), "spawn_agent".to_string());
    let mut rnd = ConstantRng(0.3);
    apply_step(&mut world, &actions, &mut rnd);
    assert_eq!(world.agents.len(), n0 + 1);
    let child_id = world.agents.last().unwrap().id.clone();
    assert_ne!(child_id, parent_id);
    assert!(
        world.edges.iter().any(|e| {
            (e.a == parent_id && e.b == child_id) || (e.b == parent_id && e.a == child_id)
        }),
        "expected edge between parent and child"
    );
    let child = world.agents.last().unwrap();
    assert!(matches!(child.kind, AgentKind::Bigco));
    assert!(child.knowledge >= 20.0);
}

#[test]
fn spawn_no_ops_at_population_cap() {
    let mut c = spawn_success_cfg();
    c.spawn.max_agents = 1;
    c.spawn.parent_cost_wealth = 5.0;
    c.spawn.min_parent_wealth_floor = 0.0;
    let mut world = create_world(c);
    world.agents[0].wealth = 500.0;
    let id = world.agents[0].id.clone();
    let mut actions = HashMap::new();
    actions.insert(id, "spawn_agent".to_string());
    let mut rnd = ConstantRng(0.2);
    apply_step(&mut world, &actions, &mut rnd);
    assert_eq!(world.agents.len(), 1);
}

#[test]
fn spawn_no_ops_when_disabled() {
    let mut c = spawn_success_cfg();
    c.spawn.enabled = false;
    let mut world = create_world(c);
    world.agents[0].wealth = 500.0;
    let n0 = world.agents.len();
    let id = world.agents[0].id.clone();
    let mut actions = HashMap::new();
    actions.insert(id, "spawn_agent".to_string());
    let mut rnd = ConstantRng(0.2);
    apply_step(&mut world, &actions, &mut rnd);
    assert_eq!(world.agents.len(), n0);
}
