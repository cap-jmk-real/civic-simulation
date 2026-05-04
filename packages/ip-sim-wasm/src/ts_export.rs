//! Serialize `SimulationRun` to the same JSON shape as `runSimulationSync` in `@ip-sim/core`.

use ip_sim_engine::sim::types::{
    Agent, AgentKind, Edge, LastRegulatoryTick, MemoryEvent, PendingInnovation, RegulatoryWorldState,
    SimulationRun, TickMetrics, TickRecord, WorldState,
};
use serde_json::{json, Map, Value};

fn kind_str(k: AgentKind) -> &'static str {
    k.as_str()
}

fn memory_to_json(m: &[MemoryEvent]) -> Value {
    Value::Array(
        m.iter()
            .map(|e| {
                json!({
                    "tick": e.tick,
                    "summary": e.summary,
                })
            })
            .collect(),
    )
}

fn pipeline_to_json(p: &[PendingInnovation]) -> Value {
    Value::Array(
        p.iter()
            .map(|x| {
                json!({
                    "deliverOnTick": x.deliver_on_tick,
                    "knowledgeGain": x.knowledge_gain,
                })
            })
            .collect(),
    )
}

fn agent_to_json(a: &Agent) -> Value {
    json!({
        "id": a.id,
        "type": kind_str(a.kind),
        "wealth": a.wealth,
        "knowledge": a.knowledge,
        "labor": a.labor,
        "patentExpiresAt": a.patent_expires_at,
        "reputation": a.reputation,
        "memory": memory_to_json(&a.memory),
        "lastProfit": a.last_profit,
        "cumulativeProfit": a.cumulative_profit,
        "innovationPipeline": pipeline_to_json(&a.innovation_pipeline),
        "lastOfferingQuality": a.last_offering_quality,
    })
}

fn edge_to_json(e: &Edge) -> Value {
    json!({
        "a": e.a,
        "b": e.b,
        "weight": e.weight,
    })
}

fn last_reg_to_json(lr: &LastRegulatoryTick) -> Value {
    json!({
        "netSocialLoad": lr.net_social_load,
        "mitigatedLoad": lr.mitigated_load,
        "effectiveStringency": lr.effective_stringency,
        "totalWealthTransfer": lr.total_wealth_transfer,
        "corruption": lr.corruption,
    })
}

fn regulatory_to_json(r: &RegulatoryWorldState) -> Value {
    json!({
        "stringency": r.stringency,
        "corruption": r.corruption,
    })
}

fn metrics_to_json(m: &TickMetrics) -> Value {
    json!({
        "tick": m.tick,
        "totalWealth": m.total_wealth,
        "meanWealth": m.mean_wealth,
        "top10Wealth": m.top10_wealth,
        "top1PercentWealth": m.top1_percent_wealth,
        "giniWealth": m.gini_wealth,
        "top10WealthShare": m.top10_wealth_share,
        "hhiMarketShare": m.hhi_market_share,
        "totalReputation": m.total_reputation,
        "top10Reputation": m.top10_reputation,
        "top1PercentReputation": m.top1_percent_reputation,
        "giniReputation": m.gini_reputation,
        "top10ReputationShare": m.top10_reputation_share,
        "innovationFlow": m.innovation_flow,
        "totalKnowledgeStock": m.total_knowledge_stock,
        "globalPool": m.global_pool,
        "powerHHI": m.power_hhi,
        "powerComponents": {
            "marketShareHHI": m.power_components_market_share_hhi,
            "patentHHI": m.power_components_patent_hhi,
            "degreeCentralityNorm": m.power_components_degree_hhi,
        },
        "regulatoryStringency": m.regulatory_stringency,
        "regulatoryCorruption": m.regulatory_corruption,
        "externalityNetLoad": m.externality_net_load,
        "externalityMitigatedLoad": m.externality_mitigated_load,
        "externalityWealthTransfer": m.externality_wealth_transfer,
        "agentCount": m.agent_count,
    })
}

fn actions_to_json(actions: &std::collections::HashMap<String, String>) -> Value {
    let mut m = Map::new();
    for (k, v) in actions {
        m.insert(k.clone(), Value::String(v.clone()));
    }
    Value::Object(m)
}

fn tick_to_json(t: &TickRecord) -> Value {
    let snaps = Value::Array(
        t.agent_snapshots
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "wealth": s.wealth,
                    "knowledge": s.knowledge,
                    "labor": s.labor,
                    "patentCount": s.patent_count,
                    "reputation": s.reputation,
                    "offeringQuality": s.offering_quality,
                })
            })
            .collect(),
    );
    let edges = Value::Array(t.edges.iter().map(edge_to_json).collect());
    json!({
        "metrics": metrics_to_json(&t.metrics),
        "actions": actions_to_json(&t.actions),
        "agentSnapshots": snaps,
        "edges": edges,
    })
}

fn world_to_json(w: &WorldState, config_echo: &Value) -> Value {
    let agents = Value::Array(w.agents.iter().map(agent_to_json).collect());
    let edges = Value::Array(w.edges.iter().map(edge_to_json).collect());
    let lr = w
        .last_regulatory_tick
        .as_ref()
        .map(last_reg_to_json)
        .unwrap_or(Value::Null);
    json!({
        "tick": w.tick,
        "agents": agents,
        "edges": edges,
        "globalPool": w.global_pool,
        "marketSize": w.market_size,
        "config": config_echo,
        "regulatory": regulatory_to_json(&w.regulatory),
        "lastRegulatoryTick": lr,
    })
}

/// `config_val` is echoed verbatim as `manifest.config` (browser-normalized JSON).
pub fn heuristic_run_to_ts_json(run: &SimulationRun, config_val: Value) -> String {
    let mut manifest = Map::new();
    manifest.insert("schemaVersion".to_string(), json!(1));
    manifest.insert("seed".to_string(), json!(run.seed));
    manifest.insert("policyMode".to_string(), json!("heuristic"));
    manifest.insert("config".to_string(), config_val.clone());

    let history = Value::Array(run.history.iter().map(tick_to_json).collect());

    let world = world_to_json(&run.final_world, &config_val);

    let out = json!({
        "manifest": Value::Object(manifest),
        "history": history,
        "finalWorld": world,
    });
    serde_json::to_string_pretty(&out).unwrap_or_else(|_| "{}".to_string())
}
