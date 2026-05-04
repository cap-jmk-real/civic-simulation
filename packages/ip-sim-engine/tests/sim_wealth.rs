//! Parity with `packages/sim-core/src/engine.wealth.test.ts` and
//! `engine.none-regime.test.ts` (pool-linked revenue under patent none).

use std::collections::HashMap;

use ip_sim_engine::rng::MulBerry32;
use ip_sim_engine::sim::metrics_tick::compute_market_shares;
use ip_sim_engine::sim::types::{GraphKind, PatentRegime, PolicyVector, SimConfig};
use ip_sim_engine::sim::{apply_step, create_world, default_sim_config};
use ip_sim_engine::ConstantRng;

fn minimal_config(patch: impl FnOnce(&mut SimConfig)) -> SimConfig {
    let mut c = default_sim_config();
    c.seed = 999;
    c.ticks = 5;
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
    c.base_market_size = 1000.0;
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

fn two_bigcos_none(patch: impl FnOnce(&mut SimConfig)) -> SimConfig {
    let mut c = default_sim_config();
    c.seed = 1;
    c.ticks = 1;
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
    c.base_market_size = 1000.0;
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
fn idle_weak_patent_sum_wealth_deltas_equals_market_size() {
    let cfg = minimal_config(|c| {
        c.agent_counts = [2, 0, 0, 0];
        c.policy.patent_regime = PatentRegime::Weak;
    });
    let m = cfg.base_market_size;
    let mut world = create_world(cfg);
    let mut rnd = ConstantRng(0.5);
    let before: Vec<f64> = world.agents.iter().map(|a| a.wealth).collect();
    let mut actions = HashMap::new();
    for a in &world.agents {
        actions.insert(a.id.clone(), "idle".to_string());
    }
    apply_step(&mut world, &actions, &mut rnd);
    let delta_sum: f64 = world
        .agents
        .iter()
        .enumerate()
        .map(|(i, a)| a.wealth - before[i])
        .sum();
    assert!((delta_sum - m).abs() < 1e-4);
}

#[test]
fn invest_rnd_cumulative_profit_matches_last_profit_wealth_less_than_profit() {
    let mut world = create_world(minimal_config(|_| {}));
    let agent_id = world.agents[0].id.clone();
    let w0 = world.agents[0].wealth;
    let cp0 = world.agents[0].cumulative_profit;
    let mut rnd = MulBerry32::new(42);
    let mut actions = HashMap::new();
    actions.insert(agent_id, "invest_rnd".to_string());
    apply_step(&mut world, &actions, &mut rnd);
    let ag = &world.agents[0];
    assert!((ag.cumulative_profit - cp0 - ag.last_profit).abs() < 1e-9);
    assert!(ag.wealth - w0 < ag.last_profit);
}

#[test]
fn negative_wealth_after_repeated_costly_rnd() {
    let cfg = minimal_config(|c| {
        c.base_market_size = 1.0;
        c.agent_counts = [2, 0, 0, 0];
    });
    let mut world = create_world(cfg);
    let ids: Vec<String> = world.agents.iter().map(|a| a.id.clone()).collect();
    let mut rnd = ConstantRng(0.99);
    for _ in 0..80 {
        let mut actions = HashMap::new();
        actions.insert(ids[0].clone(), "invest_rnd".to_string());
        actions.insert(ids[1].clone(), "idle".to_string());
        apply_step(&mut world, &actions, &mut rnd);
    }
    let min_w = world.agents.iter().map(|a| a.wealth).fold(f64::INFINITY, f64::min);
    assert!(min_w < 0.0);
}

#[test]
fn strong_patent_higher_last_profit_than_none_with_patents() {
    let mut rnd = ConstantRng(0.5);
    let mut none_world = create_world(minimal_config(|c| {
        c.policy.patent_regime = PatentRegime::None;
    }));
    none_world.agents[0].patent_expires_at.push(none_world.tick + 500);
    let id0 = none_world.agents[0].id.clone();
    let mut a0 = HashMap::new();
    a0.insert(id0, "idle".to_string());
    apply_step(&mut none_world, &a0, &mut rnd);

    let mut strong_world = create_world(minimal_config(|c| {
        c.policy.patent_regime = PatentRegime::Strong;
    }));
    strong_world.agents[0]
        .patent_expires_at
        .push(strong_world.tick + 500);
    let id1 = strong_world.agents[0].id.clone();
    let mut a1 = HashMap::new();
    a1.insert(id1, "idle".to_string());
    apply_step(&mut strong_world, &a1, &mut ConstantRng(0.5));

    assert!(strong_world.agents[0].last_profit > none_world.agents[0].last_profit);
}

#[test]
fn open_science_subsidy_increases_academic_stipend_delta() {
    let mut low = create_world(minimal_config(|c| {
        c.agent_counts = [0, 1, 0, 0];
        c.policy.patent_regime = PatentRegime::None;
        c.policy.open_science_subsidy = 0.0;
    }));
    let mut high = create_world(minimal_config(|c| {
        c.agent_counts = [0, 1, 0, 0];
        c.policy.patent_regime = PatentRegime::None;
        c.policy.open_science_subsidy = 1.0;
    }));
    let id_low = low.agents[0].id.clone();
    let id_high = high.agents[0].id.clone();
    let b0 = low.agents[0].wealth;
    let b1 = high.agents[0].wealth;
    let mut rnd = ConstantRng(0.5);
    let mut al = HashMap::new();
    al.insert(id_low, "idle".to_string());
    apply_step(&mut low, &al, &mut rnd);
    let mut ah = HashMap::new();
    ah.insert(id_high, "idle".to_string());
    apply_step(&mut high, &ah, &mut ConstantRng(0.5));
    let d_low = low.agents[0].wealth - b0;
    let d_high = high.agents[0].wealth - b1;
    assert!((d_high - d_low - 2.2).abs() < 1e-3);
}

#[test]
fn compute_market_shares_sum_positive() {
    let cfg = minimal_config(|c| {
        c.agent_counts = [3, 0, 0, 0];
    });
    let world = create_world(cfg);
    let s = compute_market_shares(
        &world.agents,
        &world.edges,
        &world.config.type_weights,
        world.config.capability_beta,
        world.config.spillover_alpha,
    );
    assert!(s.iter().sum::<f64>() > 0.0);
}

#[test]
fn patent_none_idle_sum_below_market_size_pool_multiplier() {
    let cfg = two_bigcos_none(|_| {});
    let m = cfg.base_market_size;
    let mut world = create_world(cfg);
    let before: Vec<f64> = world.agents.iter().map(|a| a.wealth).collect();
    let mut actions = HashMap::new();
    for a in &world.agents {
        actions.insert(a.id.clone(), "idle".to_string());
    }
    let mut rnd = ConstantRng(0.5);
    apply_step(&mut world, &actions, &mut rnd);
    let delta_sum: f64 = world
        .agents
        .iter()
        .enumerate()
        .map(|(i, a)| a.wealth - before[i])
        .sum();
    let pool_at_economy = 12.0;
    let expected_scale = 0.92 + pool_at_economy * 0.0015;
    assert!(delta_sum < m);
    assert!((delta_sum - m * expected_scale).abs() < 0.5);
}
