import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import type { Action, PolicyVector, SimConfig } from "./types.js";

function constantRng(x: number): () => number {
  return () => x;
}

function dynamicsBase(
  overrides: Partial<Omit<SimConfig, "policy">> & { policy?: Partial<PolicyVector> } = {},
): SimConfig {
  const { policy: policyOverrides, ...rest } = overrides;
  return mergeSimConfig({
    seed: 7,
    ticks: 10,
    agentCounts: { bigco: 1, academic: 0, smb: 0, solo: 0 },
    policy: {
      patentRegime: "none",
      patentDurationTicks: 20,
      enforcementIntensity: 0,
      litigationCostMultiplier: 1,
      openScienceSubsidy: 0,
      dataSharingMandateStrength: 0,
      regulatoryAmbition: 0,
      ...policyOverrides,
    } as PolicyVector,
    graph: { kind: "random", avgDegree: 2 },
    capabilityBeta: 0.62,
    spilloverAlpha: 0,
    baseMarketSize: 0,
    marketGrowthPerTick: 0,
    memorySlots: 5,
    memoryDecayPerTick: 0,
    typeWeights: { bigco: 1, academic: 1, smb: 1, solo: 1 },
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
    ...rest,
  });
}

describe("innovation cost (invest_rnd)", () => {
  it("adds per-knowledge marginal cost to cash spend", () => {
    const low = createWorld(
      dynamicsBase({
        investRndBaseCost: 0,
        investRndCostRandomSpan: 0,
        investRndCostPerKnowledge: 1,
      }),
    );
    const high = createWorld(
      dynamicsBase({
        investRndBaseCost: 0,
        investRndCostRandomSpan: 0,
        investRndCostPerKnowledge: 1,
      }),
    );
    low.agents[0]!.knowledge = 0;
    high.agents[0]!.knowledge = 100;
    const rnd = constantRng(0);
    const id = low.agents[0]!.id;
    const wLow = low.agents[0]!.wealth;
    const wHigh = high.agents[0]!.wealth;
    applyStep(low, { actions: { [id]: "invest_rnd" }, rnd });
    applyStep(high, { actions: { [id]: "invest_rnd" }, rnd });
    const costLow = wLow - low.agents[0]!.wealth;
    const costHigh = wHigh - high.agents[0]!.wealth;
    expect(costHigh - costLow).toBeCloseTo(100, 6);
  });
});

describe("R&D time delay", () => {
  it("defers knowledge gain by N ticks when innovationDelayTicks = N", () => {
    const w = createWorld(
      dynamicsBase({
        innovationDelayTicks: 2,
        investRndBaseCost: 0,
        investRndCostRandomSpan: 0,
        investRndCostPerKnowledge: 0,
      }),
    );
    const id = w.agents[0]!.id;
    const k0 = w.agents[0]!.knowledge;
    const gain = 4 * 1.15; // rnd=0, bigco
    const rnd = constantRng(0);
    applyStep(w, { actions: { [id]: "invest_rnd" as Action }, rnd });
    expect(w.agents[0]!.knowledge).toBeCloseTo(k0, 6);
    expect(w.tick).toBe(1);
    applyStep(w, { actions: { [id]: "idle" as Action }, rnd });
    expect(w.agents[0]!.knowledge).toBeCloseTo(k0, 6);
    expect(w.tick).toBe(2);
    applyStep(w, { actions: { [id]: "idle" as Action }, rnd });
    expect(w.agents[0]!.knowledge).toBeCloseTo(k0 + gain, 6);
  });

  it("matches immediate delivery when innovationDelayTicks is 0", () => {
    const w = createWorld(
      dynamicsBase({
        innovationDelayTicks: 0,
        investRndBaseCost: 0,
        investRndCostRandomSpan: 0,
        investRndCostPerKnowledge: 0,
      }),
    );
    const id = w.agents[0]!.id;
    const k0 = w.agents[0]!.knowledge;
    const rnd = constantRng(0);
    applyStep(w, { actions: { [id]: "invest_rnd" as Action }, rnd });
    expect(w.agents[0]!.knowledge).toBeCloseTo(k0 + 4 * 1.15, 6);
    expect(w.agents[0]!.innovationPipeline).toHaveLength(0);
  });
});

describe("depreciation", () => {
  it("scales wealth by (1 - rate) after market revenue when idle", () => {
    const w = createWorld(
      dynamicsBase({
        wealthDepreciationRate: 0.1,
        knowledgeDepreciationRate: 0,
      }),
    );
    const before = w.agents[0]!.wealth;
    applyStep(w, { actions: { [w.agents[0]!.id]: "idle" }, rnd: constantRng(0.5) });
    expect(w.agents[0]!.wealth).toBeCloseTo(before * 0.9, 6);
  });

  it("applies knowledge obsolescence at end of tick", () => {
    const w = createWorld(
      dynamicsBase({
        knowledgeDepreciationRate: 0.2,
        wealthDepreciationRate: 0,
      }),
    );
    w.agents[0]!.knowledge = 100;
    applyStep(w, { actions: { [w.agents[0]!.id]: "idle" }, rnd: constantRng(0.5) });
    expect(w.agents[0]!.knowledge).toBeCloseTo(80, 6);
  });

  it("stores fixed knowledge gain in pipeline — not reduced by later obsolescence before delivery", () => {
    const w = createWorld(
      dynamicsBase({
        innovationDelayTicks: 1,
        knowledgeDepreciationRate: 0.5,
        wealthDepreciationRate: 0,
        investRndBaseCost: 0,
        investRndCostRandomSpan: 0,
        investRndCostPerKnowledge: 0,
      }),
    );
    const id = w.agents[0]!.id;
    const rnd = constantRng(0);
    applyStep(w, { actions: { [id]: "invest_rnd" as Action }, rnd });
    expect(w.agents[0]!.innovationPipeline[0]!.knowledgeGain).toBeCloseTo(4 * 1.15, 6);
    applyStep(w, { actions: { [id]: "idle" as Action }, rnd });
    // Delivered gain is still 4.6 on top of depreciated stock
    expect(w.agents[0]!.knowledge).toBeGreaterThan(4 * 1.15);
  });
});
