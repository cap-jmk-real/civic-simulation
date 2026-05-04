/** Finite action set — LLM / heuristic / QRE must map to these strings. */
export const ACTIONS = [
  "idle",
  "invest_rnd",
  "publish_open",
  "file_patent",
  "collaborate",
  "trade",
  "enforce_ip",
  /** Pay the regulator; may raise institutional corruption or trigger multi-resource penalties if detected. */
  "bribe_regulator",
  /** Create a new agent (recruit/spin-out) if under cap and parent can afford it — grows population and graph. */
  "spawn_agent",
] as const;

export type Action = (typeof ACTIONS)[number];

export type AgentType = "bigco" | "academic" | "smb" | "solo";

/** Institutional layer orthogonal to economic {@link AgentType}: firms remain typed bigco/academic/… while holding civic roles. */
export type CivicRole = "citizen" | "politician" | "public_servant";

/**
 * Reputation-based elections + bureaucracy staffing. Disabled by default; when on, uses the same
 * `reputation` stock as the market/CES layer so civic outcomes stay tied to simulated performance.
 */
export interface GovernanceConfig {
  enabled: boolean;
  /** Calendar period for the full maintenance pass (demotions, hiring/firing servants, elections). */
  electionPeriodTicks: number;
  politicianSeats: number;
  /** Symmetric uniform noise half-width on reputation for electoral ordering only. */
  electionReputationNoise: number;
  /** Fire-at-will public servant headcount the engine tries to restore each maintenance tick. */
  fireableServantTarget: number;
  /** Tenured (non-fireable) servant headcount target. */
  tenuredServantTarget: number;
  /** Fireable servants at or above this reputation may be promoted to tenured when a slot opens. */
  tenureMinReputation: number;
  /** Weights for hiring citizens into fireable service (normalized before scoring). */
  hireBlendReputation: number;
  hireBlendKnowledge: number;
}

export type PatentRegime = "none" | "weak" | "strong";

/**
 * How `marketSize` is mapped to per-agent **base revenue** (before CES quality scaling).
 * - **edge_logit** — graph-local demand: each buyer splits a budget across {self ∪ neighbors} via softmax utilities (default).
 * - **contest_legacy** — global contest shares only (pre–Level B behavior).
 */
export type DemandModel = "edge_logit" | "contest_legacy";

/** Serialized policy knobs (world / institutional layer). */
export interface PolicyVector {
  patentRegime: PatentRegime;
  /** Ignored when patentRegime is none. */
  patentDurationTicks: number;
  enforcementIntensity: number;
  litigationCostMultiplier: number;
  openScienceSubsidy: number;
  dataSharingMandateStrength: number;
  /**
   * Policymaker appetite for regulation (0 = hands-off, 1 = strong).
   * Drives stringency in fixed mode and the attractor in dynamic mode when regulatory rules are enabled.
   */
  regulatoryAmbition: number;
}

/** Bribery of regulators — optional channel with detection risk and multi-resource penalties. */
export interface RegulatoryBribeConfig {
  enabled: boolean;
  baseCost: number;
  /** Base probability of detection per attempt (clamped to [0, 1] after corruption adjustments). */
  detectionProbability: number;
  penaltyWealth: number;
  penaltyReputation: number;
  penaltyKnowledge: number;
  /** Added to global institutional corruption on successful undetected bribe (clamped to [0, 1]). */
  corruptionDelta: number;
  /** How much corruption weakens effective enforcement stringency (0 = none, 1 = full at corruption 1). */
  corruptionErodesStringency: number;
  /** If true, higher corruption lowers detection odds (“captured regulator”). If false, corruption slightly raises scrutiny. */
  corruptionReducesDetection: boolean;
}

/**
 * Regulatory externalities: goods vs services output imposes signed social load by producer type;
 * load is allocated to actors by `victimVulnerability`. Rules can mitigate harm (not benefits).
 */
export interface RegulatoryConfig {
  enabled: boolean;
  /** `fixed` recomputes stringency each tick from ambition + corruption; `dynamic` keeps a persistent stringency with noise. */
  ruleMode: "fixed" | "dynamic";
  /** Scales how ambition maps into stringency levels. */
  policyScale: number;
  /** Baseline / initial stringency anchor ∈ [0, 1]. */
  baseStringency: number;
  /** How strongly effective stringency reduces positive net social harm (0–1 load fraction mitigated at full enforcement). */
  mitigationEfficiency: number;
  /** Per-type exposure weights for sharing aggregate harm or benefit (same shares for damage and windfalls). */
  victimVulnerability: Record<AgentType, number>;
  /** Signed: units of social “bad” per unit goods-branch quality from each producer type (negative = public good). */
  goodsExternalityByProducer: Record<AgentType, number>;
  /** Signed: units per unit services-branch quality. */
  servicesExternalityByProducer: Record<AgentType, number>;
  /** Converts mitigated load units into wealth transfers per exposure share. */
  externalityWealthScale: number;
  /** Reputation moves with wealth transfers from regulation (harm reduces rep when positive). */
  externalityReputationScale: number;
  /** AR(1) persistence for dynamic stringency (higher = smoother). */
  dynamicPersistence: number;
  /** Uniform noise half-width on dynamic stringency updates. */
  dynamicNoise: number;
  bribe: RegulatoryBribeConfig;
}

export interface GraphPreset {
  kind: "random" | "small_world" | "scale_free";
  /** Average edges per node hint for generators. */
  avgDegree: number;
}

/**
 * Runtime agent creation (`spawn_agent`). Initial `agentCounts` still seed `createWorld`;
 * population can grow until `maxAgents` (or stay unchanged if disabled / unaffordable).
 */
export interface SpawnConfig {
  enabled: boolean;
  /** Hard ceiling on `world.agents.length` (including founders). */
  maxAgents: number;
  /** Wealth removed from parent on a successful spawn. */
  parentCostWealth: number;
  /** Parent must have wealth ≥ cost + this floor before attempting (keeps solvency buffer). */
  minParentWealthFloor: number;
  /** Child starts with this fraction of parent's knowledge (≥ small floor in engine). */
  inheritKnowledgeFraction: number;
  /** Child actor type; `inherit` uses the parent's type. */
  childType: "inherit" | AgentType;
  /** Initial wealth assigned to the new agent (paid from ecosystem / abstract capitalization, not double-charged from parent beyond `parentCostWealth`). */
  childStartWealth: number;
  /** If > 0, add or strengthen an undirected edge parent–child with weight scaled around this. */
  linkParentEdgeWeight: number;
  /** Reputation bonus for parent on successful spawn. */
  parentReputationOnSuccess: number;
}

export interface SimConfig {
  seed: number;
  ticks: number;
  agentCounts: Record<AgentType, number>;
  policy: PolicyVector;
  graph: GraphPreset;
  /** Production concavity β ∈ (0,1). */
  capabilityBeta: number;
  spilloverAlpha: number;
  baseMarketSize: number;
  marketGrowthPerTick: number;
  /** Market clearing style; see {@link DemandModel}. */
  demandModel: DemandModel;
  /**
   * Softmax temperature τ in edge-logit demand. Larger ⇒ closer to uniform random sourcing
   * (higher “irrationality” / noise in discrete choice).
   */
  edgeLogitTemperature: number;
  /** Utility weight on ln(offering quality) when choosing a supplier (including self). */
  edgeLogitUtilityQuality: number;
  /** Utility weight on supplier reputation. */
  edgeLogitUtilityReputation: number;
  /** Utility weight on ln(1 + supplier knowledge) (innovation / capability signal). */
  edgeLogitUtilityKnowledge: number;
  /** Tie strength: utility multiplier `1 + edgeWeight * this` for a neighbor (not applied to self). */
  edgeLogitEdgeWeightScale: number;
  /** i.i.d. mean-zero uniform noise width added to each utility before softmax: `U(-w,w)` with `w = edgeLogitPreferenceNoise`. */
  edgeLogitPreferenceNoise: number;
  memorySlots: number;
  memoryDecayPerTick: number;
  /** Type multipliers for competitive weight baseline. */
  typeWeights: Record<AgentType, number>;

  /**
   * R&D spend per `invest_rnd`: base + U(0, randomSpan) + perKnowledge × knowledge (paid when the project starts).
   */
  investRndBaseCost: number;
  investRndCostRandomSpan: number;
  investRndCostPerKnowledge: number;
  /**
   * Ticks until `invest_rnd` knowledge arrives (0 = same tick, legacy behavior).
   * Projects complete at the start of the tick when `world.tick === deliverOnTick`.
   */
  innovationDelayTicks: number;
  /** Per-tick proportional decay on wealth (0–1). Applied after market revenue. */
  wealthDepreciationRate: number;
  /** Per-tick proportional decay on private knowledge (obsolescence). */
  knowledgeDepreciationRate: number;

  /**
   * CES offering quality from knowledge + labor; splits labor goods vs services by type.
   * Scales market revenue and feeds reputation from relative quality / sales.
   */
  cesQualityEnabled: boolean;
  /** CES weight on knowledge K vs labor L in each branch (goods / services). */
  cesAlphaKnowledge: number;
  /** CES exponent ρ (substitution); near 0 → Cobb–Douglas limit inside cesAggregate. */
  cesRho: number;
  /** Scale on CES aggregate (units matched to quality multiplier calibration). */
  cesScale: number;
  /** Blend goods CES vs services CES (0 = all services branch, 1 = all goods branch). */
  cesMixGoods: number;
  /** Strength of revenue multiplier vs cohort-relative quality (centered at 1). */
  cesRevenueGamma: number;
  /** Reputation drift from quality vs cohort mean (relative). */
  cesRepRelativeQuality: number;
  /** Reputation drift from sales vs cohort mean revenue (before quality scaling). */
  cesRepSales: number;

  regulatory: RegulatoryConfig;

  /** Optional population growth via `spawn_agent`. */
  spawn: SpawnConfig;

  /** Civic roles, elections, and public-sector staffing (off by default). */
  governance: GovernanceConfig;
}

/** Scheduled knowledge delivery from delayed R&D. */
export interface PendingInnovation {
  deliverOnTick: number;
  knowledgeGain: number;
}

export interface MemoryEvent {
  tick: number;
  summary: string;
}

export interface AgentState {
  id: string;
  type: AgentType;
  /** Policymaker or bureaucracy vs general population; see `config.governance`. */
  civicRole: CivicRole;
  /**
   * Only interpreted when `civicRole === "public_servant"`: `true` = fire-at-will tier,
   * `false` = tenured / not subject to the firing pass.
   */
  publicServantFireable: boolean;
  wealth: number;
  /** Private knowledge stock K_i */
  knowledge: number;
  /** Effective employees / team size for CES labor input (goods + services). */
  labor: number;
  /** Active patent units (each expires independently). */
  patentExpiresAt: number[];
  reputation: number;
  memory: MemoryEvent[];
  lastProfit: number;
  cumulativeProfit: number;
  /** Queued R&D outcomes (see `innovationDelayTicks`). */
  innovationPipeline: PendingInnovation[];
  /** Last tick CES offering quality used for revenue / reputation (1 if CES off). */
  lastOfferingQuality: number;
}

export interface Edge {
  a: string;
  b: string;
  weight: number;
}

/** Evolving regulatory institutions (stringency + corruption). */
export interface RegulatoryWorldState {
  /** Current enforcement stringency ∈ [0, 1] (dynamic mode persists between ticks). */
  stringency: number;
  /** Institutional capture / corruption ∈ [0, 1], raised by successful bribes. */
  corruption: number;
}

/** Snapshot after externality accounting for metrics / charts (null when regulation is off). */
export interface LastRegulatoryTick {
  netSocialLoad: number;
  mitigatedLoad: number;
  effectiveStringency: number;
  totalWealthTransfer: number;
  corruption: number;
}

export interface WorldState {
  tick: number;
  agents: AgentState[];
  edges: Edge[];
  /** Global disclosed knowledge pool (open publications). */
  globalPool: number;
  marketSize: number;
  config: SimConfig;
  regulatory: RegulatoryWorldState;
  /** Filled when `config.regulatory.enabled` after market clearing for the tick. */
  lastRegulatoryTick: LastRegulatoryTick | null;
}

/** Observation passed to policies (serializable). */
export interface AgentObservation {
  selfId: string;
  type: AgentType;
  civicRole: CivicRole;
  publicServantFireable: boolean;
  tick: number;
  wealth: number;
  knowledge: number;
  labor: number;
  patentCount: number;
  reputation: number;
  neighbors: { id: string; weight: number }[];
  globalPool: number;
  marketSize: number;
  policy: PolicyVector;
  /** Live regulatory state for decisions (bribery, ambition context). */
  regulatory: {
    enabled: boolean;
    ruleMode: "fixed" | "dynamic";
    stringency: number;
    corruption: number;
    effectiveStringency: number;
    bribeEnabled: boolean;
  };
  memory: MemoryEvent[];
  lastProfit: number;
  /** Last tick offering quality (CES); ~1 when CES disabled. */
  lastOfferingQuality: number;
  /** Number of in-flight delayed R&D projects. */
  pendingInnovationCount: number;
  /** Current population (`world.agents.length`). */
  population: number;
  /** Whether `spawn_agent` is allowed in principle (config + cap + wealth buffer). */
  spawn: {
    enabled: boolean;
    maxAgents: number;
    atCap: boolean;
    canAffordSpawn: boolean;
  };
}

export interface TickMetrics {
  tick: number;
  /** Sum of all agent wealth. */
  totalWealth: number;
  /**
   * Mean wealth per agent (totalWealth / agentCount). GDP-like scale normalization when
   * comparing economies of different population sizes; dimensionless in model units.
   */
  meanWealth: number;
  /** Sum of wealth held by the richest ceil(n·10%) agents (same cohort as top10WealthShare). */
  top10Wealth: number;
  /** Sum of wealth held by the richest max(1, ceil(n·1%)) agents. */
  top1PercentWealth: number;
  giniWealth: number;
  top10WealthShare: number;
  hhiMarketShare: number;
  /** Sum of agent reputation stocks. */
  totalReputation: number;
  /** Sum of reputation in richest ceil(n·10%) by reputation. */
  top10Reputation: number;
  /** Sum of reputation in richest max(1, ceil(n·1%)) by reputation. */
  top1PercentReputation: number;
  giniReputation: number;
  top10ReputationShare: number;
  innovationFlow: number;
  totalKnowledgeStock: number;
  globalPool: number;
  powerHHI: number;
  powerComponents: {
    marketShareHHI: number;
    patentHHI: number;
    degreeCentralityNorm: number;
  };
  /** Effective enforcement stringency after corruption erosion (0 if regulation off). */
  regulatoryStringency: number;
  /** Institutional corruption stock (0 if regulation off). */
  regulatoryCorruption: number;
  /** Signed aggregate externality load from goods+services channels before mitigation. */
  externalityNetLoad: number;
  /** Load after applying mitigation to positive harm only. */
  externalityMitigatedLoad: number;
  /** Sum of absolute wealth deltas from the externality pass. */
  externalityWealthTransfer: number;
  /** Number of agents after this tick’s `applyStep` (post-actions, pre-next-tick in history snapshot). */
  agentCount: number;
  /** Populated when governance is enabled; otherwise zeroed. */
  civicPoliticianCount: number;
  civicPublicServantFireableCount: number;
  civicPublicServantTenuredCount: number;
  civicCitizenCount: number;
}

export interface TickRecord {
  metrics: TickMetrics;
  actions: Record<string, Action>;
  agentSnapshots: Array<{
    id: string;
    civicRole: CivicRole;
    publicServantFireable: boolean;
    wealth: number;
    knowledge: number;
    labor: number;
    patentCount: number;
    reputation: number;
    offeringQuality: number;
  }>;
  /** Collaboration edges after this tick’s updates (for timeline scrubbing). */
  edges: Edge[];
}

export interface RunManifest {
  schemaVersion: 1;
  seed: number;
  policyMode: "heuristic" | "qre" | "llm";
  qreTemperature?: number;
  llmModel?: string;
  config: SimConfig;
}

export interface SimulationRun {
  manifest: RunManifest;
  history: TickRecord[];
}
