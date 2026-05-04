import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import type { AgentState, Edge } from "./types.js";
import {
  computeMarketShares,
  computeTickMetrics,
  gini,
  hhi,
  stockDistribution,
} from "./metrics.js";

describe("gini", () => {
  it("returns 0 for empty array", () => {
    expect(gini([])).toBe(0);
  });

  it("returns 0 when all wealth is zero", () => {
    expect(gini([0, 0, 0])).toBe(0);
  });

  it("returns 0 for equal positive wealth", () => {
    expect(gini([10, 10, 10, 10])).toBeCloseTo(0, 8);
  });

  it("is high when one agent holds almost everything", () => {
    const g = gini([0.001, 0.001, 100]);
    expect(g).toBeGreaterThan(0.6);
  });

  it("ignores NaN entries", () => {
    expect(gini([10, NaN, 10])).toBeCloseTo(0, 8);
  });

  it("matches textbook two-person closed form", () => {
    const g = gini([0, 100]);
    expect(g).toBeCloseTo(0.5, 8);
  });
});

describe("hhi", () => {
  it("returns 0 for empty", () => {
    expect(hhi([])).toBe(0);
  });

  it("returns 1 for single positive share", () => {
    expect(hhi([100])).toBeCloseTo(1, 8);
  });

  it("returns 0.5 for two equal shares", () => {
    expect(hhi([50, 50])).toBeCloseTo(0.5, 8);
  });
});

function fakeAgent(
  id: string,
  type: AgentState["type"],
  wealth: number,
  knowledge: number,
  patents: number[] = [],
): AgentState {
  return {
    id,
    type,
    civicRole: "citizen",
    publicServantFireable: true,
    wealth,
    knowledge,
    patentExpiresAt: patents,
    reputation: 1,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    labor: 5,
    lastOfferingQuality: 1,
  };
}

function withRep(a: AgentState, rep: number): AgentState {
  return { ...a, reputation: rep };
}

describe("stockDistribution", () => {
  it("aggregates top cohorts for nonnegative stocks", () => {
    const d = stockDistribution(Array.from({ length: 100 }, () => 3));
    expect(d.total).toBe(300);
    expect(d.gini).toBeCloseTo(0, 6);
    expect(d.top10Share).toBeCloseTo(0.1, 6);
  });
});

describe("computeMarketShares", () => {
  const weights = {
    bigco: 1.65,
    academic: 0.85,
    smb: 1.05,
    solo: 0.95,
  };

  it("produces strictly positive weights for zero knowledge via floor in cap", () => {
    const agents = [
      fakeAgent("a", "solo", 10, 0),
      fakeAgent("b", "solo", 10, 0),
    ];
    const shares = computeMarketShares(agents, [], weights, 0.62, 0.35);
    expect(shares.every((s) => s > 0)).toBe(true);
    expect(shares.every((s) => s >= 1e-6)).toBe(true);
  });

  it("increases weight with patent stock", () => {
    const base = fakeAgent("x", "smb", 10, 20, []);
    const withPat = fakeAgent("y", "smb", 10, 20, [100, 101]);
    const s0 = computeMarketShares([base], [], weights, 0.62, 0.35)[0]!;
    const s1 = computeMarketShares([withPat], [], weights, 0.62, 0.35)[0]!;
    expect(s1).toBeGreaterThan(s0);
  });

  it("responds to spilloverAlpha via neighbor knowledge", () => {
    const a = fakeAgent("a", "solo", 10, 50);
    const b = fakeAgent("b", "solo", 10, 100);
    const edges: Edge[] = [{ a: "a", b: "b", weight: 1 }];
    const low = computeMarketShares([a, b], edges, weights, 0.62, 0.01);
    const high = computeMarketShares([a, b], edges, weights, 0.62, 0.9);
    expect(high[0]!).not.toEqual(low[0]!);
  });
});

describe("computeTickMetrics", () => {
  it("handles empty agent list without throwing", () => {
    const world = {
      tick: 1,
      agents: [] as AgentState[],
      edges: [] as Edge[],
      globalPool: 0,
      marketSize: 100,
      regulatory: { stringency: 0, corruption: 0 },
      lastRegulatoryTick: null,
      config: mergeSimConfig({
        seed: 1,
        ticks: 1,
        agentCounts: { bigco: 0, academic: 0, smb: 0, solo: 0 },
        policy: {
          patentRegime: "none",
          patentDurationTicks: 10,
          enforcementIntensity: 0,
          litigationCostMultiplier: 1,
          openScienceSubsidy: 0,
          dataSharingMandateStrength: 0,
          regulatoryAmbition: 0,
        },
        graph: { kind: "random", avgDegree: 2 },
        capabilityBeta: 0.62,
        spilloverAlpha: 0.35,
        baseMarketSize: 100,
        marketGrowthPerTick: 0,
        memorySlots: 5,
        memoryDecayPerTick: 0,
        typeWeights: {
          bigco: 1,
          academic: 1,
          smb: 1,
          solo: 1,
        },
        investRndBaseCost: 9,
        investRndCostRandomSpan: 3,
        investRndCostPerKnowledge: 0,
        innovationDelayTicks: 0,
        wealthDepreciationRate: 0,
        knowledgeDepreciationRate: 0,
        cesQualityEnabled: false,
        cesAlphaKnowledge: 0.55,
        cesRho: -0.35,
        cesScale: 0.14,
        cesMixGoods: 0.5,
        cesRevenueGamma: 0.28,
        cesRepRelativeQuality: 0.07,
        cesRepSales: 0.0005,
      }),
    };
    const m = computeTickMetrics(world, 0);
    expect(m.totalWealth).toBe(0);
    expect(m.top10Wealth).toBe(0);
    expect(m.top1PercentWealth).toBe(0);
    expect(m.giniWealth).toBe(0);
    expect(m.top10WealthShare).toBe(0);
    expect(m.meanWealth).toBe(0);
    expect(m.totalReputation).toBe(0);
    expect(m.giniReputation).toBe(0);
    expect(m.agentCount).toBe(0);
    expect(m.civicCitizenCount).toBe(0);
    expect(m.civicPoliticianCount).toBe(0);
  });

  it("total / top 10% / top 1% wealth match richest cohort sums", () => {
    const agents: AgentState[] = Array.from({ length: 100 }, (_, i) =>
      fakeAgent(`id-${i}`, "solo", 1, 5),
    );
    const world = {
      tick: 1,
      agents,
      edges: [] as Edge[],
      globalPool: 0,
      marketSize: 100,
      regulatory: { stringency: 0, corruption: 0 },
      lastRegulatoryTick: null,
      config: mergeSimConfig({
        seed: 1,
        ticks: 1,
        agentCounts: { bigco: 0, academic: 0, smb: 0, solo: 100 },
        policy: {
          patentRegime: "none",
          patentDurationTicks: 10,
          enforcementIntensity: 0,
          litigationCostMultiplier: 1,
          openScienceSubsidy: 0,
          dataSharingMandateStrength: 0,
          regulatoryAmbition: 0,
        },
        graph: { kind: "random", avgDegree: 2 },
        capabilityBeta: 0.62,
        spilloverAlpha: 0,
        baseMarketSize: 100,
        marketGrowthPerTick: 0,
        memorySlots: 5,
        memoryDecayPerTick: 0,
        typeWeights: {
          bigco: 1,
          academic: 1,
          smb: 1,
          solo: 1,
        },
        investRndBaseCost: 9,
        investRndCostRandomSpan: 3,
        investRndCostPerKnowledge: 0,
        innovationDelayTicks: 0,
        wealthDepreciationRate: 0,
        knowledgeDepreciationRate: 0,
        cesQualityEnabled: false,
        cesAlphaKnowledge: 0.55,
        cesRho: -0.35,
        cesScale: 0.14,
        cesMixGoods: 0.5,
        cesRevenueGamma: 0.28,
        cesRepRelativeQuality: 0.07,
        cesRepSales: 0.0005,
      }),
    };
    const m = computeTickMetrics(world, 0);
    expect(m.totalWealth).toBe(100);
    expect(m.meanWealth).toBe(1);
    expect(m.top10Wealth).toBe(10);
    expect(m.top1PercentWealth).toBe(1);
    expect(m.agentCount).toBe(100);
  });

  it("reputation concentration mirrors wealth structure for equal stocks", () => {
    const agents: AgentState[] = Array.from({ length: 100 }, (_, i) =>
      withRep(fakeAgent(`id-${i}`, "solo", 1, 5), 2),
    );
    const world = {
      tick: 1,
      agents,
      edges: [] as Edge[],
      globalPool: 0,
      marketSize: 100,
      regulatory: { stringency: 0, corruption: 0 },
      lastRegulatoryTick: null,
      config: mergeSimConfig({
        seed: 1,
        ticks: 1,
        agentCounts: { bigco: 0, academic: 0, smb: 0, solo: 100 },
        policy: {
          patentRegime: "none",
          patentDurationTicks: 10,
          enforcementIntensity: 0,
          litigationCostMultiplier: 1,
          openScienceSubsidy: 0,
          dataSharingMandateStrength: 0,
          regulatoryAmbition: 0,
        },
        graph: { kind: "random", avgDegree: 2 },
        capabilityBeta: 0.62,
        spilloverAlpha: 0,
        baseMarketSize: 100,
        marketGrowthPerTick: 0,
        memorySlots: 5,
        memoryDecayPerTick: 0,
        typeWeights: {
          bigco: 1,
          academic: 1,
          smb: 1,
          solo: 1,
        },
        investRndBaseCost: 9,
        investRndCostRandomSpan: 3,
        investRndCostPerKnowledge: 0,
        innovationDelayTicks: 0,
        wealthDepreciationRate: 0,
        knowledgeDepreciationRate: 0,
        cesQualityEnabled: false,
        cesAlphaKnowledge: 0.55,
        cesRho: -0.35,
        cesScale: 0.14,
        cesMixGoods: 0.5,
        cesRevenueGamma: 0.28,
        cesRepRelativeQuality: 0.07,
        cesRepSales: 0.0005,
      }),
    };
    const m = computeTickMetrics(world, 0);
    expect(m.totalReputation).toBe(200);
    expect(m.top10Reputation).toBe(20);
    expect(m.top1PercentReputation).toBe(2);
    expect(m.giniReputation).toBeCloseTo(0, 6);
  });

  it("exposes regulatory scalars from world state", () => {
    const agents: AgentState[] = [fakeAgent("id-0", "solo", 10, 5)];
    const world = {
      tick: 2,
      agents,
      edges: [] as Edge[],
      globalPool: 1,
      marketSize: 50,
      regulatory: { stringency: 0.4, corruption: 0.15 },
      lastRegulatoryTick: {
        netSocialLoad: 0.5,
        mitigatedLoad: 0.2,
        effectiveStringency: 0.35,
        totalWealthTransfer: 12,
        corruption: 0.15,
      },
      config: mergeSimConfig({
        seed: 1,
        ticks: 1,
        agentCounts: { bigco: 0, academic: 0, smb: 0, solo: 1 },
        policy: {
          patentRegime: "none",
          patentDurationTicks: 10,
          enforcementIntensity: 0,
          litigationCostMultiplier: 1,
          openScienceSubsidy: 0,
          dataSharingMandateStrength: 0,
          regulatoryAmbition: 0,
        },
      }),
    };
    const m = computeTickMetrics(world, 0);
    expect(m.externalityNetLoad).toBe(0.5);
    expect(m.externalityMitigatedLoad).toBe(0.2);
    expect(m.regulatoryStringency).toBe(0.35);
    expect(m.regulatoryCorruption).toBe(0.15);
    expect(m.externalityWealthTransfer).toBe(12);
    expect(m.agentCount).toBe(1);
  });
});
