import type { SimConfig } from "./types.js";

/**
 * Default [`SimConfig`](./types.ts): population, policy, graph, market, R&D costs, depreciation, and CES quality parameters.
 * Returns a new object each call.
 */
export const defaultSimConfig = (): SimConfig => ({
  seed: 42,
  ticks: 120,
  agentCounts: {
    bigco: 3,
    academic: 6,
    smb: 8,
    solo: 7,
  },
  policy: {
    patentRegime: "weak",
    patentDurationTicks: 40,
    enforcementIntensity: 0.35,
    litigationCostMultiplier: 1,
    openScienceSubsidy: 0.2,
    dataSharingMandateStrength: 0.15,
    regulatoryAmbition: 0.45,
  },
  graph: {
    kind: "small_world",
    avgDegree: 3,
  },
  capabilityBeta: 0.62,
  spilloverAlpha: 0.35,
  baseMarketSize: 220,
  marketGrowthPerTick: 0.15,
  demandModel: "edge_logit",
  edgeLogitTemperature: 1,
  edgeLogitUtilityQuality: 1,
  edgeLogitUtilityReputation: 0.02,
  edgeLogitUtilityKnowledge: 0.01,
  edgeLogitEdgeWeightScale: 0.1,
  edgeLogitPreferenceNoise: 0,
  memorySlots: 12,
  memoryDecayPerTick: 0.08,
  typeWeights: {
    bigco: 1.65,
    academic: 0.85,
    smb: 1.05,
    solo: 0.95,
  },
  investRndBaseCost: 9,
  investRndCostRandomSpan: 3,
  investRndCostPerKnowledge: 0,
  innovationDelayTicks: 0,
  wealthDepreciationRate: 0,
  knowledgeDepreciationRate: 0,
  cesQualityEnabled: true,
  cesAlphaKnowledge: 0.55,
  cesRho: -0.35,
  cesScale: 0.14,
  cesMixGoods: 0.52,
  cesRevenueGamma: 0.28,
  cesRepRelativeQuality: 0.07,
  cesRepSales: 0.0005,

  regulatory: {
    enabled: false,
    ruleMode: "dynamic",
    policyScale: 1,
    baseStringency: 0.55,
    mitigationEfficiency: 0.65,
    victimVulnerability: {
      bigco: 0.55,
      academic: 1.15,
      smb: 1,
      solo: 1.05,
    },
    goodsExternalityByProducer: {
      bigco: 0.14,
      academic: -0.04,
      smb: 0.06,
      solo: 0.09,
    },
    servicesExternalityByProducer: {
      bigco: 0.05,
      academic: 0.1,
      smb: -0.02,
      solo: 0.04,
    },
    externalityWealthScale: 3.5,
    externalityReputationScale: 0.012,
    dynamicPersistence: 0.82,
    dynamicNoise: 0.035,
    bribe: {
      enabled: true,
      baseCost: 6,
      detectionProbability: 0.22,
      penaltyWealth: 28,
      penaltyReputation: 0.85,
      penaltyKnowledge: 2.5,
      corruptionDelta: 0.07,
      corruptionErodesStringency: 0.55,
      corruptionReducesDetection: true,
    },
  },

  spawn: {
    enabled: false,
    maxAgents: 220,
    parentCostWealth: 32,
    minParentWealthFloor: 28,
    inheritKnowledgeFraction: 0.28,
    childType: "inherit",
    childStartWealth: 22,
    linkParentEdgeWeight: 0.42,
    parentReputationOnSuccess: 0.05,
  },

  governance: {
    enabled: false,
    electionPeriodTicks: 30,
    politicianSeats: 2,
    electionReputationNoise: 0.04,
    fireableServantTarget: 2,
    tenuredServantTarget: 1,
    tenureMinReputation: 1.05,
    hireBlendReputation: 0.55,
    hireBlendKnowledge: 0.45,
  },
});

/**
 * Deep-merge `overrides` with {@link defaultSimConfig}. Nested `policy`, `agentCounts`, `typeWeights`, and `graph` are merged; other keys override.
 */
export function mergeSimConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  const d = defaultSimConfig();
  return {
    ...d,
    ...overrides,
    policy: { ...d.policy, ...overrides.policy },
    agentCounts: { ...d.agentCounts, ...overrides.agentCounts },
    typeWeights: { ...d.typeWeights, ...overrides.typeWeights },
    graph: { ...d.graph, ...overrides.graph },
    regulatory: {
      ...d.regulatory,
      ...overrides.regulatory,
      bribe: { ...d.regulatory.bribe, ...overrides.regulatory?.bribe },
      victimVulnerability: {
        ...d.regulatory.victimVulnerability,
        ...overrides.regulatory?.victimVulnerability,
      },
      goodsExternalityByProducer: {
        ...d.regulatory.goodsExternalityByProducer,
        ...overrides.regulatory?.goodsExternalityByProducer,
      },
      servicesExternalityByProducer: {
        ...d.regulatory.servicesExternalityByProducer,
        ...overrides.regulatory?.servicesExternalityByProducer,
      },
    },
    spawn: { ...d.spawn, ...overrides.spawn },
    governance: { ...d.governance, ...overrides.governance },
  };
}
