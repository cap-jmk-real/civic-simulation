//! Parity with `packages/sim-core/src/engine.trade.test.ts`.

use std::collections::HashMap;

use ip_sim_engine::sim::types::{Edge, GraphKind, PatentRegime, PolicyVector, SimConfig, WorldState};
use ip_sim_engine::sim::{apply_step, create_world, default_sim_config};
use ip_sim_engine::ConstantRng;

fn two_agent_world(patch: impl FnOnce(&mut SimConfig)) -> WorldState {
    let mut c = default_sim_config();
    c.seed = 77;
    c.ticks = 2;
    c.agent_counts = [2, 0, 0, 0];
    c.policy = PolicyVector {
        patent_regime: PatentRegime::None,
        patent_duration_ticks: 20,
        enforcement_intensity: 0.0,
        litigation_cost_multiplier: 1.0,
        open_science_subsidy: 0.0,
        data_sharing_mandate_strength: 0.0,
        regulatory_ambition: 0.0,
    };
    c.graph.kind = GraphKind::Random;
    c.graph.avg_degree = 2;
    c.capability_beta = 0.62;
    c.spillover_alpha = 0.0;
    c.base_market_size = 0.0;
    c.market_growth_per_tick = 0.0;
    c.memory_slots = 5;
    c.memory_decay_per_tick = 0.0;
    c.type_weights = [1.0, 1.0, 1.0, 1.0];
    c.invest_rnd_base_cost = 9.0;
    c.invest_rnd_cost_random_span = 3.0;
    c.invest_rnd_cost_per_knowledge = 0.0;
    c.innovation_delay_ticks = 0;
    c.wealth_depreciation_rate = 0.0;
    c.knowledge_depreciation_rate = 0.0;
    c.ces_quality_enabled = false;
    c.ces_alpha_knowledge = 0.55;
    c.ces_rho = -0.35;
    c.ces_scale = 0.14;
    c.ces_mix_goods = 0.5;
    c.ces_revenue_gamma = 0.28;
    c.ces_rep_relative_quality = 0.07;
    c.ces_rep_sales = 0.0005;
    patch(&mut c);
    let mut w = create_world(c);
    let a = w.agents[0].id.clone();
    let b = w.agents[1].id.clone();
    w.edges = vec![Edge {
        a: a.clone(),
        b: b.clone(),
        weight: 1.0,
    }];
    w
}

#[test]
fn trade_paired_with_edge_bilateral_neutral_fees_reduce_total_by_two() {
    let mut w = two_agent_world(|_| {});
    let a = w.agents[0].id.clone();
    let b = w.agents[1].id.clone();
    let sum0 = w.agents[0].wealth + w.agents[1].wealth;
    let mut actions = HashMap::new();
    actions.insert(a, "trade".to_string());
    actions.insert(b, "trade".to_string());
    let mut rnd = ConstantRng(0.3);
    apply_step(&mut w, &actions, &mut rnd);
    let sum1 = w.agents[0].wealth + w.agents[1].wealth;
    assert!((sum1 - (sum0 - 2.0)).abs() < 1e-5);
}

#[test]
fn trade_unpaired_odd_one_pays_single_fee() {
    let mut w = two_agent_world(|_| {});
    let a = w.agents[0].id.clone();
    let b = w.agents[1].id.clone();
    let sum0 = w.agents[0].wealth + w.agents[1].wealth;
    let mut actions = HashMap::new();
    actions.insert(a, "trade".to_string());
    actions.insert(b, "idle".to_string());
    let mut rnd = ConstantRng(0.3);
    apply_step(&mut w, &actions, &mut rnd);
    let sum1 = w.agents[0].wealth + w.agents[1].wealth;
    assert!((sum1 - (sum0 - 1.0)).abs() < 1e-5);
}

#[test]
fn collaborate_paired_reputation_bump_sum() {
    let mut w = two_agent_world(|_| {});
    let a = w.agents[0].id.clone();
    let b = w.agents[1].id.clone();
    let r0 = w.agents[0].reputation + w.agents[1].reputation;
    let mut actions = HashMap::new();
    actions.insert(a, "collaborate".to_string());
    actions.insert(b, "collaborate".to_string());
    let mut rnd = ConstantRng(0.2);
    apply_step(&mut w, &actions, &mut rnd);
    let r1 = w.agents[0].reputation + w.agents[1].reputation;
    assert!((r1 - r0 - 0.04).abs() < 1e-5);
}
