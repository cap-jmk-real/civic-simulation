//! Parity with `packages/sim-core/src/engine.policy-params.test.ts`.

use std::collections::HashMap;

use ip_sim_engine::sim::types::{GraphKind, PatentRegime, PolicyVector, SimConfig};
use ip_sim_engine::sim::{apply_step, create_world, default_sim_config};
use ip_sim_engine::ConstantRng;

fn base() -> SimConfig {
    let mut c = default_sim_config();
    c.seed = 42;
    c.ticks = 1;
    c.agent_counts = [2, 0, 0, 0];
    c.policy = PolicyVector {
        patent_regime: PatentRegime::Weak,
        patent_duration_ticks: 40,
        enforcement_intensity: 0.5,
        litigation_cost_multiplier: 2.0,
        open_science_subsidy: 0.3,
        data_sharing_mandate_strength: 0.4,
        regulatory_ambition: 0.45,
    };
    c.graph.kind = GraphKind::Random;
    c.graph.avg_degree = 2;
    c.capability_beta = 0.62;
    c.spillover_alpha = 0.2;
    c.base_market_size = 500.0;
    c.market_growth_per_tick = 0.1;
    c.memory_slots = 8;
    c.memory_decay_per_tick = 0.05;
    c.type_weights = [1.65, 0.85, 1.05, 0.95];
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
    c
}

#[test]
fn data_sharing_mandate_increases_publish_open_pool_contribution() {
    let mut low = {
        let mut c = base();
        c.policy.data_sharing_mandate_strength = 0.0;
        create_world(c)
    };
    let id = low.agents[0].id.clone();
    let mut rnd = ConstantRng(0.5);
    let mut a = HashMap::new();
    a.insert(id.clone(), "publish_open".to_string());
    apply_step(&mut low, &a, &mut rnd);
    let pool_low = low.global_pool;

    let mut high2 = {
        let mut c = base();
        c.policy.data_sharing_mandate_strength = 1.0;
        create_world(c)
    };
    let mut rnd2 = ConstantRng(0.5);
    let mut a2 = HashMap::new();
    a2.insert(id, "publish_open".to_string());
    apply_step(&mut high2, &a2, &mut rnd2);
    assert!(high2.global_pool > pool_low);
}

#[test]
fn litigation_cost_multiplier_scales_enforce_ip_cost() {
    let mut cheap = {
        let mut c = base();
        c.policy.litigation_cost_multiplier = 0.5;
        create_world(c)
    };
    let mut pricey = {
        let mut c = base();
        c.policy.litigation_cost_multiplier = 3.0;
        create_world(c)
    };
    let id = cheap.agents[0].id.clone();
    let w_cheap_before = cheap.agents[0].wealth;
    let w_price_before = pricey.agents[0].wealth;
    let mut rnd = ConstantRng(0.1);
    let mut ac = HashMap::new();
    ac.insert(id.clone(), "enforce_ip".to_string());
    apply_step(&mut cheap, &ac, &mut rnd);
    let mut ap = HashMap::new();
    ap.insert(id, "enforce_ip".to_string());
    apply_step(&mut pricey, &ap, &mut ConstantRng(0.1));
    let cost_cheap = w_cheap_before - cheap.agents[0].wealth;
    let cost_price = w_price_before - pricey.agents[0].wealth;
    assert!(cost_price > cost_cheap);
}

#[test]
fn file_patent_records_expiry_at_tick_plus_duration() {
    let mut c = base();
    c.policy.patent_regime = PatentRegime::Weak;
    c.policy.patent_duration_ticks = 99;
    let mut w = create_world(c);
    let mut rnd = ConstantRng(0.3);
    let id = w.agents[0].id.clone();
    let mut a = HashMap::new();
    a.insert(id, "file_patent".to_string());
    apply_step(&mut w, &a, &mut rnd);
    assert_eq!(w.agents[0].patent_expires_at.len(), 1);
    assert_eq!(w.agents[0].patent_expires_at[0], 99);
}
