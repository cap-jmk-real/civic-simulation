//! Agent / world construction — shared so `engine_actions` avoids importing `engine`.

use crate::rng::{MulBerry32, Rng01};
use crate::sim::graph_gen::generate_initial_edges;
use crate::sim::regulatory::clamp01;
use crate::sim::types::*;

pub fn create_agent_of_type(kind: AgentKind, id_seq: &mut u32) -> Agent {
    let start_wealth = match kind {
        AgentKind::Bigco => 180.0,
        AgentKind::Academic => 70.0,
        AgentKind::Smb => 95.0,
        AgentKind::Solo => 75.0,
    };
    let start_k = match kind {
        AgentKind::Academic => 22.0,
        AgentKind::Bigco => 28.0,
        _ => 18.0,
    };
    let base_labor = match kind {
        AgentKind::Bigco => 16.0,
        AgentKind::Academic => 5.0,
        AgentKind::Smb => 8.0,
        AgentKind::Solo => 4.0,
    };
    *id_seq += 1;
    let n = *id_seq;
    let id = format!("{}-{}", kind.as_str(), n);
    Agent {
        id,
        kind,
        wealth: start_wealth + n as f64 * 0.01,
        knowledge: start_k,
        labor: base_labor + n as f64 * 0.001,
        patent_expires_at: Vec::new(),
        reputation: if matches!(kind, AgentKind::Academic) { 1.2 } else { 1.0 },
        memory: Vec::new(),
        last_profit: 0.0,
        cumulative_profit: 0.0,
        innovation_pipeline: Vec::new(),
        last_offering_quality: 1.0,
    }
}

pub fn create_agents_from_counts(counts: [u32; 4], id_seq: &mut u32) -> Vec<Agent> {
    let order = [
        AgentKind::Bigco,
        AgentKind::Academic,
        AgentKind::Smb,
        AgentKind::Solo,
    ];
    let mut agents = Vec::new();
    for (i, k) in order.iter().enumerate() {
        for _ in 0..counts[i] {
            agents.push(create_agent_of_type(*k, id_seq));
        }
    }
    agents
}

pub fn create_world(cfg: SimConfig) -> WorldState {
    let mut id_seq: u32 = 0;
    let mut rng = MulBerry32::new(cfg.seed);
    let agents = create_agents_from_counts(cfg.agent_counts, &mut id_seq);
    let edges = generate_initial_edges(&agents, &cfg.graph, &mut rng);
    let ambition = clamp01(cfg.policy.regulatory_ambition);
    let reg = &cfg.regulatory;
    let initial_str = clamp01(
        reg.base_stringency * (0.2 + 0.8 * ambition) * reg.policy_scale,
    );
    WorldState {
        tick: 0,
        agents,
        edges,
        global_pool: 12.0,
        market_size: cfg.base_market_size,
        config: cfg,
        regulatory: RegulatoryWorldState {
            stringency: initial_str,
            corruption: 0.0,
        },
        last_regulatory_tick: None,
        id_seq,
    }
}

pub fn find_edge(world: &WorldState, a: &str, b: &str) -> Option<usize> {
    world
        .edges
        .iter()
        .position(|e| (e.a == a && e.b == b) || (e.a == b && e.b == a))
}

pub fn add_or_strengthen_edge<R: Rng01 + ?Sized>(
    world: &mut WorldState,
    a: &str,
    b: &str,
    rnd: &mut R,
) {
    if let Some(ix) = find_edge(world, a, b) {
        let w = world.edges[ix].weight;
        world.edges[ix].weight = (w + 0.15 + rnd.next_f64() * 0.1).min(3.0);
    } else {
        world.edges.push(Edge {
            a: a.to_string(),
            b: b.to_string(),
            weight: 0.35 + rnd.next_f64() * 0.25,
        });
    }
}
