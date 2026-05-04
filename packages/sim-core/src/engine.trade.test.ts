import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import type { Action, PolicyVector, SimConfig } from "./types.js";

function constantRng(x: number): () => number {
  return () => x;
}

function twoAgentWorld(
  overrides: Partial<Omit<SimConfig, "policy">> & { policy?: Partial<PolicyVector> } = {},
): ReturnType<typeof createWorld> {
  const { policy: po, ...rest } = overrides;
  const cfg: SimConfig = mergeSimConfig({
    seed: 77,
    ticks: 2,
    agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
    policy: {
      patentRegime: "none",
      patentDurationTicks: 20,
      enforcementIntensity: 0,
      litigationCostMultiplier: 1,
      openScienceSubsidy: 0,
      dataSharingMandateStrength: 0,
      regulatoryAmbition: 0,
      ...po,
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
  const w = createWorld(cfg);
  const a = w.agents[0]!.id;
  const b = w.agents[1]!.id;
  w.edges = [{ a, b, weight: 1 }];
  return w;
}

describe("trade action", () => {
  it("paired traders with an edge: bilateral transfer is wealth-neutral; participation fees reduce total", () => {
    const w = twoAgentWorld();
    const a = w.agents[0]!.id;
    const b = w.agents[1]!.id;
    const sum0 = w.agents[0]!.wealth + w.agents[1]!.wealth;
    const actions: Record<string, Action> = { [a]: "trade", [b]: "trade" };
    applyStep(w, { actions, rnd: constantRng(0.3) });
    const sum1 = w.agents[0]!.wealth + w.agents[1]!.wealth;
    expect(sum1).toBeCloseTo(sum0 - 2, 6);
  });

  it("unpaired trade (odd count): one agent only pays fee", () => {
    const w = twoAgentWorld();
    const a = w.agents[0]!.id;
    const b = w.agents[1]!.id;
    const sum0 = w.agents[0]!.wealth + w.agents[1]!.wealth;
    applyStep(w, {
      actions: { [a]: "trade", [b]: "idle" },
      rnd: constantRng(0.3),
    });
    const sum1 = w.agents[0]!.wealth + w.agents[1]!.wealth;
    expect(sum1).toBeCloseTo(sum0 - 1, 6);
  });
});

describe("collaboration reputation bump", () => {
  it("increases reputation for both paired collaborators", () => {
    const w = twoAgentWorld();
    const a = w.agents[0]!.id;
    const b = w.agents[1]!.id;
    const r0 = w.agents[0]!.reputation + w.agents[1]!.reputation;
    applyStep(w, {
      actions: { [a]: "collaborate", [b]: "collaborate" },
      rnd: constantRng(0.2),
    });
    const r1 = w.agents[0]!.reputation + w.agents[1]!.reputation;
    expect(r1 - r0).toBeCloseTo(0.04, 6);
  });
});
