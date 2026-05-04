import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import type { Action, AgentState, SimConfig } from "./types.js";

function constantRng(x: number): () => number {
  return () => x;
}

function base(): SimConfig {
  return mergeSimConfig({
    seed: 42,
    ticks: 1,
    agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
    policy: {
      patentRegime: "weak",
      patentDurationTicks: 40,
      enforcementIntensity: 0.5,
      litigationCostMultiplier: 2,
      openScienceSubsidy: 0.3,
      dataSharingMandateStrength: 0.4,
      regulatoryAmbition: 0.45,
    },
    graph: { kind: "random", avgDegree: 2 },
    capabilityBeta: 0.62,
    spilloverAlpha: 0.2,
    baseMarketSize: 500,
    marketGrowthPerTick: 0.1,
    memorySlots: 8,
    memoryDecayPerTick: 0.05,
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
    cesQualityEnabled: false,
    cesAlphaKnowledge: 0.55,
    cesRho: -0.35,
    cesScale: 0.14,
    cesMixGoods: 0.5,
    cesRevenueGamma: 0.28,
    cesRepRelativeQuality: 0.07,
    cesRepSales: 0.0005,
  });
}

function idleActions(agents: AgentState[]): Record<string, Action> {
  const a: Record<string, Action> = {};
  for (const ag of agents) a[ag.id] = "idle";
  return a;
}

describe("policy parameter effects (isolated applyStep)", () => {
  it("dataSharingMandateStrength increases publish_open pool contribution", () => {
    const low = createWorld({ ...base(), policy: { ...base().policy, dataSharingMandateStrength: 0 } });
    const high = createWorld({ ...base(), policy: { ...base().policy, dataSharingMandateStrength: 1 } });
    const rnd = constantRng(0.5);
    const id = low.agents[0]!.id;
    applyStep(low, { actions: { [id]: "publish_open" }, rnd });
    const poolLow = low.globalPool;
    const high2 = createWorld({ ...base(), policy: { ...base().policy, dataSharingMandateStrength: 1 } });
    applyStep(high2, { actions: { [id]: "publish_open" }, rnd });
    expect(high2.globalPool).toBeGreaterThan(poolLow);
  });

  it("litigationCostMultiplier scales enforce_ip cost", () => {
    const cheap = createWorld({ ...base(), policy: { ...base().policy, litigationCostMultiplier: 0.5 } });
    const pricey = createWorld({ ...base(), policy: { ...base().policy, litigationCostMultiplier: 3 } });
    const rnd = constantRng(0.1);
    const id = cheap.agents[0]!.id;
    const wCheapBefore = cheap.agents[0]!.wealth;
    const wPriceBefore = pricey.agents[0]!.wealth;
    applyStep(cheap, { actions: { [id]: "enforce_ip" }, rnd });
    applyStep(pricey, { actions: { [id]: "enforce_ip" }, rnd });
    const costCheap = wCheapBefore - cheap.agents[0]!.wealth;
    const costPrice = wPriceBefore - pricey.agents[0]!.wealth;
    expect(costPrice).toBeGreaterThan(costCheap);
  });

  it("file_patent records expiry at tick + patentDurationTicks", () => {
    const cfg = base();
    const w = createWorld({
      ...cfg,
      policy: { ...cfg.policy, patentRegime: "weak", patentDurationTicks: 99 },
    });
    const rnd = constantRng(0.3);
    const id = w.agents[0]!.id;
    applyStep(w, { actions: { [id]: "file_patent" }, rnd });
    expect(w.agents[0]!.patentExpiresAt.length).toBe(1);
    expect(w.agents[0]!.patentExpiresAt[0]).toBe(99);
  });
});
