import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import { computeMarketShares } from "./metrics.js";
import { mulberry32 } from "./rng.js";
import type { Action, PolicyVector, SimConfig } from "./types.js";

/** RNG that always returns `x` in [0,1). */
function constantRng(x: number): () => number {
  return () => x;
}

function minimalConfig(
  overrides: Partial<Omit<SimConfig, "policy">> & {
    policy?: Partial<PolicyVector>;
  } = {},
): SimConfig {
  const { policy: policyOverrides, ...rest } = overrides;
  return mergeSimConfig({
    seed: 999,
    ticks: 5,
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
    baseMarketSize: 1000,
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
    ...rest,
  });
}

describe("market revenue conservation", () => {
  it("default edge_logit: idle sum of wealth deltas equals marketSize when license income is zero", () => {
    const cfg = minimalConfig({
      agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
      // "none" applies a global revenue multiplier so Σ revenue ≠ marketSize; use weak for pure share test
      policy: { patentRegime: "weak" },
    });
    expect(cfg.demandModel).toBe("edge_logit");
    const world = createWorld(cfg);
    const rnd = constantRng(0.5);
    const actions: Record<string, Action> = {};
    for (const a of world.agents) actions[a.id] = "idle";

    const M = cfg.baseMarketSize;
    const before = world.agents.map((a) => a.wealth);
    applyStep(world, { actions, rnd });
    const deltas = world.agents.map((a, i) => a.wealth - before[i]!);

    expect(deltas.reduce((s, x) => s + x, 0)).toBeCloseTo(M, 6);
  });

  it("idle agents (contest_legacy): sum of wealth deltas equals total marketSize when license income is zero", () => {
    const cfg = minimalConfig({
      demandModel: "contest_legacy",
      agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
      // "none" applies a global revenue multiplier so Σ revenue ≠ marketSize; use weak for pure share test
      policy: { patentRegime: "weak" },
    });
    const world = createWorld(cfg);
    const rnd = constantRng(0.5);
    const actions: Record<string, Action> = {};
    for (const a of world.agents) actions[a.id] = "idle";

    const M = cfg.baseMarketSize;
    const before = world.agents.map((a) => a.wealth);
    applyStep(world, { actions, rnd });
    const deltas = world.agents.map((a, i) => a.wealth - before[i]!);

    expect(deltas.reduce((s, x) => s + x, 0)).toBeCloseTo(M, 6);
  });

  it("cumulativeProfit increments by lastProfit only (market revenue line); not equal to net wealth change when actions cost cash", () => {
    const cfg = minimalConfig();
    const world = createWorld(cfg);
    const agent = world.agents[0]!;
    const rnd = mulberry32(42);
    const w0 = agent.wealth;
    const cp0 = agent.cumulativeProfit;

    applyStep(world, {
      actions: { [agent.id]: "invest_rnd" },
      rnd,
    });

    expect(agent.cumulativeProfit - cp0).toBe(agent.lastProfit);
    expect(agent.wealth - w0).toBeLessThan(agent.lastProfit);
  });
});

describe("negative wealth", () => {
  it("can occur under repeated costly actions and tiny market", () => {
    const cfg = minimalConfig({
      baseMarketSize: 1,
      agentCounts: { bigco: 2, academic: 0, smb: 0, solo: 0 },
    });
    const world = createWorld(cfg);
    const rnd = constantRng(0.99);
    const ids = world.agents.map((a) => a.id);
    for (let t = 0; t < 80; t++) {
      applyStep(world, {
        actions: {
          [ids[0]!]: "invest_rnd",
          [ids[1]!]: "idle",
        },
        rnd,
      });
    }
    expect(Math.min(...world.agents.map((a) => a.wealth))).toBeLessThan(0);
  });
});

describe("patent regime and licensing", () => {
  it("strong regime yields higher lastProfit than none when the agent holds patents", () => {
    const rnd = constantRng(0.5);

    const noneWorld = createWorld(
      minimalConfig({ policy: { patentRegime: "none" } }),
    );
    noneWorld.agents[0]!.patentExpiresAt = [noneWorld.tick + 500];
    applyStep(noneWorld, {
      actions: { [noneWorld.agents[0]!.id]: "idle" },
      rnd,
    });

    const strongWorld = createWorld(
      minimalConfig({ policy: { patentRegime: "strong" } }),
    );
    strongWorld.agents[0]!.patentExpiresAt = [strongWorld.tick + 500];
    applyStep(strongWorld, {
      actions: { [strongWorld.agents[0]!.id]: "idle" },
      rnd,
    });

    expect(strongWorld.agents[0]!.lastProfit).toBeGreaterThan(
      noneWorld.agents[0]!.lastProfit,
    );
  });

  it("openScienceSubsidy increases academic stipend (delta vs subsidy=0)", () => {
    const low = createWorld(
      minimalConfig({
        agentCounts: { bigco: 0, academic: 1, smb: 0, solo: 0 },
        policy: { patentRegime: "none", openScienceSubsidy: 0 },
      }),
    );
    const high = createWorld(
      minimalConfig({
        agentCounts: { bigco: 0, academic: 1, smb: 0, solo: 0 },
        policy: { patentRegime: "none", openScienceSubsidy: 1 },
      }),
    );
    const rnd = constantRng(0.5);
    const b0 = low.agents[0]!.wealth;
    const b1 = high.agents[0]!.wealth;
    applyStep(low, { actions: { [low.agents[0]!.id]: "idle" }, rnd });
    applyStep(high, { actions: { [high.agents[0]!.id]: "idle" }, rnd });
    const dLow = low.agents[0]!.wealth - b0;
    const dHigh = high.agents[0]!.wealth - b1;
    expect(dHigh - dLow).toBeCloseTo(2.2, 4);
  });
});

describe("computeMarketShares sums", () => {
  it("positive weights always sum to a positive number (used as denominator)", () => {
    const cfg = minimalConfig({ agentCounts: { bigco: 3, academic: 0, smb: 0, solo: 0 } });
    const world = createWorld(cfg);
    const s = computeMarketShares(
      world.agents,
      world.edges,
      cfg.typeWeights,
      cfg.capabilityBeta,
      cfg.spilloverAlpha,
    );
    expect(s.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
