//! Parity with `packages/sim-core/src/engine.dynamics.test.ts`.

use std::collections::HashMap;

use ip_sim_engine::sim::types::{GraphKind, PatentRegime, PolicyVector, SimConfig};
use ip_sim_engine::sim::{apply_step, create_world, default_sim_config};
use ip_sim_engine::ConstantRng;

fn dynamics_base(patch: impl FnOnce(&mut SimConfig)) -> SimConfig {
    let mut c = default_sim_config();
    c.seed = 7;
    c.ticks = 10;
    c.agent_counts = [1, 0, 0, 0];
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
    c
}

#[test]
fn invest_rnd_per_knowledge_marginal_cost() {
    let mut low = create_world(dynamics_base(|c| {
        c.invest_rnd_base_cost = 0.0;
        c.invest_rnd_cost_random_span = 0.0;
        c.invest_rnd_cost_per_knowledge = 1.0;
    }));
    let mut high = create_world(dynamics_base(|c| {
        c.invest_rnd_base_cost = 0.0;
        c.invest_rnd_cost_random_span = 0.0;
        c.invest_rnd_cost_per_knowledge = 1.0;
    }));
    low.agents[0].knowledge = 0.0;
    high.agents[0].knowledge = 100.0;
    let mut rnd = ConstantRng(0.0);
    let id = low.agents[0].id.clone();
    let w_low = low.agents[0].wealth;
    let w_high = high.agents[0].wealth;
    let mut a_low = HashMap::new();
    a_low.insert(id.clone(), "invest_rnd".to_string());
    let mut a_high = HashMap::new();
    a_high.insert(high.agents[0].id.clone(), "invest_rnd".to_string());
    apply_step(&mut low, &a_low, &mut rnd);
    apply_step(&mut high, &a_high, &mut rnd);
    let cost_low = w_low - low.agents[0].wealth;
    let cost_high = w_high - high.agents[0].wealth;
    assert!((cost_high - cost_low - 100.0).abs() < 1e-5);
}

#[test]
fn rnd_delay_defers_knowledge_by_n_ticks() {
    let mut world = create_world(dynamics_base(|c| {
        c.innovation_delay_ticks = 2;
        c.invest_rnd_base_cost = 0.0;
        c.invest_rnd_cost_random_span = 0.0;
        c.invest_rnd_cost_per_knowledge = 0.0;
    }));
    let id = world.agents[0].id.clone();
    let k0 = world.agents[0].knowledge;
    let gain = 4.0 * 1.15;
    let mut rnd = ConstantRng(0.0);
    let mut a = HashMap::new();
    a.insert(id.clone(), "invest_rnd".to_string());
    apply_step(&mut world, &a, &mut rnd);
    assert!((world.agents[0].knowledge - k0).abs() < 1e-5);
    assert_eq!(world.tick, 1);
    let mut idle = HashMap::new();
    idle.insert(id.clone(), "idle".to_string());
    apply_step(&mut world, &idle, &mut rnd);
    assert!((world.agents[0].knowledge - k0).abs() < 1e-5);
    assert_eq!(world.tick, 2);
    apply_step(&mut world, &idle, &mut rnd);
    assert!((world.agents[0].knowledge - (k0 + gain)).abs() < 1e-5);
}

#[test]
fn rnd_immediate_when_delay_zero() {
    let mut world = create_world(dynamics_base(|c| {
        c.innovation_delay_ticks = 0;
        c.invest_rnd_base_cost = 0.0;
        c.invest_rnd_cost_random_span = 0.0;
        c.invest_rnd_cost_per_knowledge = 0.0;
    }));
    let id = world.agents[0].id.clone();
    let k0 = world.agents[0].knowledge;
    let mut rnd = ConstantRng(0.0);
    let mut a = HashMap::new();
    a.insert(id, "invest_rnd".to_string());
    apply_step(&mut world, &a, &mut rnd);
    assert!((world.agents[0].knowledge - (k0 + 4.0 * 1.15)).abs() < 1e-5);
    assert!(world.agents[0].innovation_pipeline.is_empty());
}

#[test]
fn wealth_depreciation_after_idle() {
    let mut world = create_world(dynamics_base(|c| {
        c.wealth_depreciation_rate = 0.1;
        c.knowledge_depreciation_rate = 0.0;
    }));
    let before = world.agents[0].wealth;
    let id = world.agents[0].id.clone();
    let mut a = HashMap::new();
    a.insert(id, "idle".to_string());
    let mut rnd = ConstantRng(0.5);
    apply_step(&mut world, &a, &mut rnd);
    assert!((world.agents[0].wealth - before * 0.9).abs() < 1e-4);
}

#[test]
fn knowledge_depreciation_end_of_tick() {
    let mut world = create_world(dynamics_base(|c| {
        c.knowledge_depreciation_rate = 0.2;
        c.wealth_depreciation_rate = 0.0;
    }));
    world.agents[0].knowledge = 100.0;
    let id = world.agents[0].id.clone();
    let mut a = HashMap::new();
    a.insert(id, "idle".to_string());
    let mut rnd = ConstantRng(0.5);
    apply_step(&mut world, &a, &mut rnd);
    assert!((world.agents[0].knowledge - 80.0).abs() < 1e-5);
}

#[test]
fn pipeline_gain_fixed_not_pre_reduced_by_obsolescence() {
    let mut world = create_world(dynamics_base(|c| {
        c.innovation_delay_ticks = 1;
        c.knowledge_depreciation_rate = 0.5;
        c.wealth_depreciation_rate = 0.0;
        c.invest_rnd_base_cost = 0.0;
        c.invest_rnd_cost_random_span = 0.0;
        c.invest_rnd_cost_per_knowledge = 0.0;
    }));
    let id = world.agents[0].id.clone();
    let mut rnd = ConstantRng(0.0);
    let mut a = HashMap::new();
    a.insert(id.clone(), "invest_rnd".to_string());
    apply_step(&mut world, &a, &mut rnd);
    assert!((world.agents[0].innovation_pipeline[0].knowledge_gain - 4.0 * 1.15).abs() < 1e-5);
    let mut idle = HashMap::new();
    idle.insert(id, "idle".to_string());
    apply_step(&mut world, &idle, &mut rnd);
    assert!(world.agents[0].knowledge > 4.0 * 1.15);
}
