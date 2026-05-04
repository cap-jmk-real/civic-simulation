//! Parse browser `SimConfig` JSON (camelCase) into `ip_sim_engine::sim::SimConfig`.

use ip_sim_engine::sim::config::default_sim_config;
use ip_sim_engine::sim::types::{
    AgentKind, DemandModel, GraphKind, PatentRegime, RegulatoryRuleMode, SimConfig,
};
use serde_json::Value;

fn f64_at(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key)
        .and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))
        .filter(|x| x.is_finite())
        .unwrap_or(default)
}

fn u32_at(v: &Value, key: &str, default: u32) -> u32 {
    v.get(key)
        .and_then(|x| x.as_u64().or_else(|| x.as_i64().map(|i| i.max(0) as u64)))
        .unwrap_or(default as u64) as u32
}

fn usize_at(v: &Value, key: &str, default: usize) -> usize {
    v.get(key)
        .and_then(|x| x.as_u64().or_else(|| x.as_i64().map(|i| i.max(0) as u64)))
        .unwrap_or(default as u64) as usize
}

fn bool_at(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(default)
}

fn four_f64_record(v: &Value, default: &[f64; 4]) -> [f64; 4] {
    let Some(o) = v.as_object() else {
        return *default;
    };
    let read = |k: &str, i: usize| {
        o.get(k)
            .and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|n| n as f64)))
            .filter(|x| x.is_finite())
            .unwrap_or(default[i])
    };
    [
        read("bigco", 0),
        read("academic", 1),
        read("smb", 2),
        read("solo", 3),
    ]
}

fn patent_regime(s: &str) -> PatentRegime {
    match s {
        "none" => PatentRegime::None,
        "strong" => PatentRegime::Strong,
        _ => PatentRegime::Weak,
    }
}

fn graph_kind(s: &str) -> GraphKind {
    match s {
        "random" => GraphKind::Random,
        "scale_free" => GraphKind::ScaleFree,
        _ => GraphKind::SmallWorld,
    }
}

fn demand_model(s: &str) -> DemandModel {
    match s {
        "contest_legacy" => DemandModel::ContestLegacy,
        _ => DemandModel::EdgeLogit,
    }
}

fn rule_mode(s: &str) -> RegulatoryRuleMode {
    match s {
        "fixed" => RegulatoryRuleMode::Fixed,
        _ => RegulatoryRuleMode::Dynamic,
    }
}

/// Parse full `SimConfig` JSON. Unknown keys are ignored; missing keys use engine defaults.
pub fn sim_config_from_value(v: &Value) -> Result<SimConfig, String> {
    v.as_object()
        .ok_or_else(|| "config must be a JSON object".to_string())?;

    let mut c = default_sim_config();

    c.seed = u32_at(v, "seed", c.seed);
    c.ticks = u32_at(v, "ticks", c.ticks);
    c.capability_beta = f64_at(v, "capabilityBeta", c.capability_beta);
    c.spillover_alpha = f64_at(v, "spilloverAlpha", c.spillover_alpha);
    c.base_market_size = f64_at(v, "baseMarketSize", c.base_market_size);
    c.market_growth_per_tick = f64_at(v, "marketGrowthPerTick", c.market_growth_per_tick);
    c.edge_logit_temperature = f64_at(v, "edgeLogitTemperature", c.edge_logit_temperature);
    c.edge_logit_utility_quality = f64_at(v, "edgeLogitUtilityQuality", c.edge_logit_utility_quality);
    c.edge_logit_utility_reputation =
        f64_at(v, "edgeLogitUtilityReputation", c.edge_logit_utility_reputation);
    c.edge_logit_utility_knowledge =
        f64_at(v, "edgeLogitUtilityKnowledge", c.edge_logit_utility_knowledge);
    c.edge_logit_edge_weight_scale =
        f64_at(v, "edgeLogitEdgeWeightScale", c.edge_logit_edge_weight_scale);
    c.edge_logit_preference_noise =
        f64_at(v, "edgeLogitPreferenceNoise", c.edge_logit_preference_noise);
    c.memory_slots = usize_at(v, "memorySlots", c.memory_slots);
    c.memory_decay_per_tick = f64_at(v, "memoryDecayPerTick", c.memory_decay_per_tick);
    c.invest_rnd_base_cost = f64_at(v, "investRndBaseCost", c.invest_rnd_base_cost);
    c.invest_rnd_cost_random_span = f64_at(v, "investRndCostRandomSpan", c.invest_rnd_cost_random_span);
    c.invest_rnd_cost_per_knowledge =
        f64_at(v, "investRndCostPerKnowledge", c.invest_rnd_cost_per_knowledge);
    c.innovation_delay_ticks = u32_at(v, "innovationDelayTicks", c.innovation_delay_ticks);
    c.wealth_depreciation_rate = f64_at(v, "wealthDepreciationRate", c.wealth_depreciation_rate);
    c.knowledge_depreciation_rate =
        f64_at(v, "knowledgeDepreciationRate", c.knowledge_depreciation_rate);
    c.ces_quality_enabled = bool_at(v, "cesQualityEnabled", c.ces_quality_enabled);
    c.ces_alpha_knowledge = f64_at(v, "cesAlphaKnowledge", c.ces_alpha_knowledge);
    c.ces_rho = f64_at(v, "cesRho", c.ces_rho);
    c.ces_scale = f64_at(v, "cesScale", c.ces_scale);
    c.ces_mix_goods = f64_at(v, "cesMixGoods", c.ces_mix_goods);
    c.ces_revenue_gamma = f64_at(v, "cesRevenueGamma", c.ces_revenue_gamma);
    c.ces_rep_relative_quality = f64_at(v, "cesRepRelativeQuality", c.ces_rep_relative_quality);
    c.ces_rep_sales = f64_at(v, "cesRepSales", c.ces_rep_sales);

    if let Some(s) = v.get("demandModel").and_then(|x| x.as_str()) {
        c.demand_model = demand_model(s);
    }

    if let Some(ac) = v.get("agentCounts") {
        let d = [
            c.agent_counts[0] as f64,
            c.agent_counts[1] as f64,
            c.agent_counts[2] as f64,
            c.agent_counts[3] as f64,
        ];
        let arr = four_f64_record(ac, &d);
        c.agent_counts = [
            arr[0].max(0.0) as u32,
            arr[1].max(0.0) as u32,
            arr[2].max(0.0) as u32,
            arr[3].max(0.0) as u32,
        ];
    }

    if let Some(tw) = v.get("typeWeights") {
        let d = c.type_weights;
        c.type_weights = four_f64_record(tw, &d);
    }

    if let Some(p) = v.get("policy") {
        if let Some(s) = p.get("patentRegime").and_then(|x| x.as_str()) {
            c.policy.patent_regime = patent_regime(s);
        }
        c.policy.patent_duration_ticks =
            u32_at(p, "patentDurationTicks", c.policy.patent_duration_ticks);
        c.policy.enforcement_intensity =
            f64_at(p, "enforcementIntensity", c.policy.enforcement_intensity);
        c.policy.litigation_cost_multiplier =
            f64_at(p, "litigationCostMultiplier", c.policy.litigation_cost_multiplier);
        c.policy.open_science_subsidy = f64_at(p, "openScienceSubsidy", c.policy.open_science_subsidy);
        c.policy.data_sharing_mandate_strength = f64_at(
            p,
            "dataSharingMandateStrength",
            c.policy.data_sharing_mandate_strength,
        );
        c.policy.regulatory_ambition = f64_at(p, "regulatoryAmbition", c.policy.regulatory_ambition);
    }

    if let Some(g) = v.get("graph") {
        if let Some(s) = g.get("kind").and_then(|x| x.as_str()) {
            c.graph.kind = graph_kind(s);
        }
        c.graph.avg_degree = u32_at(g, "avgDegree", c.graph.avg_degree);
    }

    if let Some(r) = v.get("regulatory") {
        c.regulatory.enabled = bool_at(r, "enabled", c.regulatory.enabled);
        if let Some(s) = r.get("ruleMode").and_then(|x| x.as_str()) {
            c.regulatory.rule_mode = rule_mode(s);
        }
        c.regulatory.policy_scale = f64_at(r, "policyScale", c.regulatory.policy_scale);
        c.regulatory.base_stringency = f64_at(r, "baseStringency", c.regulatory.base_stringency);
        c.regulatory.mitigation_efficiency =
            f64_at(r, "mitigationEfficiency", c.regulatory.mitigation_efficiency);
        c.regulatory.externality_wealth_scale =
            f64_at(r, "externalityWealthScale", c.regulatory.externality_wealth_scale);
        c.regulatory.externality_reputation_scale = f64_at(
            r,
            "externalityReputationScale",
            c.regulatory.externality_reputation_scale,
        );
        c.regulatory.dynamic_persistence =
            f64_at(r, "dynamicPersistence", c.regulatory.dynamic_persistence);
        c.regulatory.dynamic_noise = f64_at(r, "dynamicNoise", c.regulatory.dynamic_noise);

        if let Some(vv) = r.get("victimVulnerability") {
            c.regulatory.victim_vulnerability = four_f64_record(vv, &c.regulatory.victim_vulnerability);
        }
        if let Some(ge) = r.get("goodsExternalityByProducer") {
            c.regulatory.goods_externality_by_producer =
                four_f64_record(ge, &c.regulatory.goods_externality_by_producer);
        }
        if let Some(se) = r.get("servicesExternalityByProducer") {
            c.regulatory.services_externality_by_producer =
                four_f64_record(se, &c.regulatory.services_externality_by_producer);
        }

        if let Some(b) = r.get("bribe") {
            let bb = &mut c.regulatory.bribe;
            bb.enabled = bool_at(b, "enabled", bb.enabled);
            bb.base_cost = f64_at(b, "baseCost", bb.base_cost);
            bb.detection_probability = f64_at(b, "detectionProbability", bb.detection_probability);
            bb.penalty_wealth = f64_at(b, "penaltyWealth", bb.penalty_wealth);
            bb.penalty_reputation = f64_at(b, "penaltyReputation", bb.penalty_reputation);
            bb.penalty_knowledge = f64_at(b, "penaltyKnowledge", bb.penalty_knowledge);
            bb.corruption_delta = f64_at(b, "corruptionDelta", bb.corruption_delta);
            bb.corruption_erodes_stringency =
                f64_at(b, "corruptionErodesStringency", bb.corruption_erodes_stringency);
            bb.corruption_reduces_detection =
                bool_at(b, "corruptionReducesDetection", bb.corruption_reduces_detection);
        }
    }

    if let Some(sp) = v.get("spawn") {
        c.spawn.enabled = bool_at(sp, "enabled", c.spawn.enabled);
        c.spawn.max_agents = u32_at(sp, "maxAgents", c.spawn.max_agents);
        c.spawn.parent_cost_wealth = f64_at(sp, "parentCostWealth", c.spawn.parent_cost_wealth);
        c.spawn.min_parent_wealth_floor =
            f64_at(sp, "minParentWealthFloor", c.spawn.min_parent_wealth_floor);
        c.spawn.inherit_knowledge_fraction =
            f64_at(sp, "inheritKnowledgeFraction", c.spawn.inherit_knowledge_fraction);
        c.spawn.child_start_wealth = f64_at(sp, "childStartWealth", c.spawn.child_start_wealth);
        c.spawn.link_parent_edge_weight =
            f64_at(sp, "linkParentEdgeWeight", c.spawn.link_parent_edge_weight);
        c.spawn.parent_reputation_on_success =
            f64_at(sp, "parentReputationOnSuccess", c.spawn.parent_reputation_on_success);

        if let Some(ct) = sp.get("childType").and_then(|x| x.as_str()) {
            if ct == "inherit" {
                c.spawn.child_type_inherit = true;
                c.spawn.child_type = None;
            } else if let Some(k) = AgentKind::from_str(ct) {
                c.spawn.child_type_inherit = false;
                c.spawn.child_type = Some(k);
            }
        }
    }

    Ok(c)
}

/// Parse JSON string; returns `(SimConfig, parsed Value)` for manifest echo.
pub fn parse_sim_config_json(input: &str) -> Result<(SimConfig, Value), String> {
    let v: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    let c = sim_config_from_value(&v)?;
    Ok((c, v))
}
