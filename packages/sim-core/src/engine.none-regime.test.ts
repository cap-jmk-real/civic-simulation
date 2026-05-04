import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import type { Action, SimConfig } from "./types.js";

function constantRng(x: number): () => number {
  return () => x;
}

function twoBigcos_none(cfg: Partial<SimConfig> = {}): SimConfig {
  return mergeSimConfig({
    seed: 1,
    ticks: 1,
    agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
    policy: {
      patentRegime: "none",
      patentDurationTicks: 20,
      enforcementIntensity: 0,
      litigationCostMultiplier: 1,
      openScienceSubsidy: 0,
      dataSharingMandateStrength: 0,
      regulatoryAmbition: 0,
      ...cfg.policy,
    },
    graph: { kind: "random", avgDegree: 2 },
    capabilityBeta: 0.62,
    spilloverAlpha: 0,
    baseMarketSize: 1000,
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
    ...cfg,
  });
}

/**
 * Under patentRegime "none", engine scales revenue by (0.92 + globalPool * 0.0015),
 * so the sum of market payouts is strictly below baseMarketSize unless pool is huge.
 * This is intentional policy modeling but breaks ΣΔwealth = M without licenses.
 */
describe("patentRegime none — revenue scaling", () => {
  it("sum of idle wealth gains is below marketSize (pool-linked multiplier)", () => {
    const cfg = twoBigcos_none();
    const world = createWorld(cfg);
    const before = world.agents.map((a) => a.wealth);
    const actions: Record<string, Action> = {};
    for (const a of world.agents) actions[a.id] = "idle";
    applyStep(world, { actions, rnd: constantRng(0.5) });
    const deltaSum = world.agents.reduce((s, a, i) => s + (a.wealth - before[i]!), 0);
    const poolAtEconomy = 12;
    const expectedScale = 0.92 + poolAtEconomy * 0.0015;
    expect(deltaSum).toBeLessThan(cfg.baseMarketSize);
    expect(deltaSum).toBeCloseTo(cfg.baseMarketSize * expectedScale, 0);
  });
});
