//! Types mirroring `packages/sim-core/src/types.ts` (subset needed for the engine).

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum AgentKind {
    Bigco = 0,
    Academic = 1,
    Smb = 2,
    Solo = 3,
}

impl AgentKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentKind::Bigco => "bigco",
            AgentKind::Academic => "academic",
            AgentKind::Smb => "smb",
            AgentKind::Solo => "solo",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "bigco" => Some(AgentKind::Bigco),
            "academic" => Some(AgentKind::Academic),
            "smb" => Some(AgentKind::Smb),
            "solo" => Some(AgentKind::Solo),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatentRegime {
    None,
    Weak,
    Strong,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphKind {
    Random,
    SmallWorld,
    ScaleFree,
}

/// How `market_size` maps to per-agent base revenue before CES scaling.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DemandModel {
    /// Graph-local softmax demand (Level B); default.
    #[default]
    EdgeLogit,
    /// Historical global contest pool only.
    ContestLegacy,
}

#[derive(Clone, Copy, Debug)]
pub struct GraphPreset {
    pub kind: GraphKind,
    pub avg_degree: u32,
}

#[derive(Clone, Debug)]
pub struct PolicyVector {
    pub patent_regime: PatentRegime,
    pub patent_duration_ticks: u32,
    pub enforcement_intensity: f64,
    pub litigation_cost_multiplier: f64,
    pub open_science_subsidy: f64,
    pub data_sharing_mandate_strength: f64,
    pub regulatory_ambition: f64,
}

#[derive(Clone, Debug)]
pub struct RegulatoryBribeConfig {
    pub enabled: bool,
    pub base_cost: f64,
    pub detection_probability: f64,
    pub penalty_wealth: f64,
    pub penalty_reputation: f64,
    pub penalty_knowledge: f64,
    pub corruption_delta: f64,
    pub corruption_erodes_stringency: f64,
    pub corruption_reduces_detection: bool,
}

#[derive(Clone, Debug)]
pub struct RegulatoryConfig {
    pub enabled: bool,
    pub rule_mode: RegulatoryRuleMode,
    pub policy_scale: f64,
    pub base_stringency: f64,
    pub mitigation_efficiency: f64,
    pub victim_vulnerability: [f64; 4],
    pub goods_externality_by_producer: [f64; 4],
    pub services_externality_by_producer: [f64; 4],
    pub externality_wealth_scale: f64,
    pub externality_reputation_scale: f64,
    pub dynamic_persistence: f64,
    pub dynamic_noise: f64,
    pub bribe: RegulatoryBribeConfig,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegulatoryRuleMode {
    Fixed,
    Dynamic,
}

#[derive(Clone, Debug)]
pub struct SpawnConfig {
    pub enabled: bool,
    pub max_agents: u32,
    pub parent_cost_wealth: f64,
    pub min_parent_wealth_floor: f64,
    pub inherit_knowledge_fraction: f64,
    pub child_type_inherit: bool,
    pub child_type: Option<AgentKind>,
    pub child_start_wealth: f64,
    pub link_parent_edge_weight: f64,
    pub parent_reputation_on_success: f64,
}

#[derive(Clone, Debug)]
pub struct SimConfig {
    pub seed: u32,
    pub ticks: u32,
    pub agent_counts: [u32; 4],
    pub policy: PolicyVector,
    pub graph: GraphPreset,
    pub capability_beta: f64,
    pub spillover_alpha: f64,
    pub base_market_size: f64,
    pub market_growth_per_tick: f64,
    pub demand_model: DemandModel,
    /// Softmax temperature τ (edge logit); larger ⇒ more uniform sourcing.
    pub edge_logit_temperature: f64,
    pub edge_logit_utility_quality: f64,
    pub edge_logit_utility_reputation: f64,
    pub edge_logit_utility_knowledge: f64,
    pub edge_logit_edge_weight_scale: f64,
    /// Uniform noise half-width on utility before softmax (`U(-w,w)` per candidate).
    pub edge_logit_preference_noise: f64,
    pub memory_slots: usize,
    pub memory_decay_per_tick: f64,
    pub type_weights: [f64; 4],
    pub invest_rnd_base_cost: f64,
    pub invest_rnd_cost_random_span: f64,
    pub invest_rnd_cost_per_knowledge: f64,
    pub innovation_delay_ticks: u32,
    pub wealth_depreciation_rate: f64,
    pub knowledge_depreciation_rate: f64,
    pub ces_quality_enabled: bool,
    pub ces_alpha_knowledge: f64,
    pub ces_rho: f64,
    pub ces_scale: f64,
    pub ces_mix_goods: f64,
    pub ces_revenue_gamma: f64,
    pub ces_rep_relative_quality: f64,
    pub ces_rep_sales: f64,
    pub regulatory: RegulatoryConfig,
    pub spawn: SpawnConfig,
}

#[derive(Clone, Debug)]
pub struct MemoryEvent {
    pub tick: u32,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub struct PendingInnovation {
    pub deliver_on_tick: u32,
    pub knowledge_gain: f64,
}

#[derive(Clone, Debug)]
pub struct Agent {
    pub id: String,
    pub kind: AgentKind,
    pub wealth: f64,
    pub knowledge: f64,
    pub labor: f64,
    pub patent_expires_at: Vec<u32>,
    pub reputation: f64,
    pub memory: Vec<MemoryEvent>,
    pub last_profit: f64,
    pub cumulative_profit: f64,
    pub innovation_pipeline: Vec<PendingInnovation>,
    pub last_offering_quality: f64,
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub a: String,
    pub b: String,
    pub weight: f64,
}

#[derive(Clone, Debug)]
pub struct RegulatoryWorldState {
    pub stringency: f64,
    pub corruption: f64,
}

#[derive(Clone, Debug)]
pub struct LastRegulatoryTick {
    pub net_social_load: f64,
    pub mitigated_load: f64,
    pub effective_stringency: f64,
    pub total_wealth_transfer: f64,
    pub corruption: f64,
}

#[derive(Clone, Debug)]
pub struct WorldState {
    pub tick: u32,
    pub agents: Vec<Agent>,
    pub edges: Vec<Edge>,
    pub global_pool: f64,
    pub market_size: f64,
    pub config: SimConfig,
    pub regulatory: RegulatoryWorldState,
    pub last_regulatory_tick: Option<LastRegulatoryTick>,
    /// Matches TS module `idCounter` after initial `create_world` (for `spawn_agent`).
    pub(crate) id_seq: u32,
}

#[derive(Clone, Debug)]
pub struct TickMetrics {
    pub tick: u32,
    pub total_wealth: f64,
    /// `total_wealth / max(1, agent_count)` — matches TS `TickMetrics.meanWealth`.
    pub mean_wealth: f64,
    pub top10_wealth: f64,
    pub top1_percent_wealth: f64,
    pub gini_wealth: f64,
    pub top10_wealth_share: f64,
    pub total_reputation: f64,
    pub top10_reputation: f64,
    pub top1_percent_reputation: f64,
    pub gini_reputation: f64,
    pub top10_reputation_share: f64,
    pub hhi_market_share: f64,
    pub innovation_flow: f64,
    pub total_knowledge_stock: f64,
    pub global_pool: f64,
    pub power_hhi: f64,
    pub power_components_market_share_hhi: f64,
    pub power_components_patent_hhi: f64,
    pub power_components_degree_hhi: f64,
    pub regulatory_stringency: f64,
    pub regulatory_corruption: f64,
    pub externality_net_load: f64,
    pub externality_mitigated_load: f64,
    pub externality_wealth_transfer: f64,
    pub agent_count: usize,
}

#[derive(Clone, Debug)]
pub struct AgentSnapshot {
    pub id: String,
    pub wealth: f64,
    pub knowledge: f64,
    pub labor: f64,
    pub patent_count: usize,
    pub reputation: f64,
    pub offering_quality: f64,
}

use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct TickRecord {
    pub metrics: TickMetrics,
    pub actions: HashMap<String, String>,
    pub agent_snapshots: Vec<AgentSnapshot>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Debug)]
pub struct SimulationRun {
    pub seed: u32,
    pub history: Vec<TickRecord>,
    /// World state after the last applied tick (mirrors `finalWorld` in TS).
    pub final_world: WorldState,
}
