import { describe, expect, it } from "vitest";
import { createWorld, runSimulationSync } from "./engine.js";
import { defaultSimConfig } from "./defaultConfig.js";
import { heuristicPolicy } from "./policies/heuristic.js";
import type { AgentState, WorldState } from "./types.js";

describe("runSimulationSync integration", () => {
  it("produces history length equal to config.ticks", () => {
    const cfg = defaultSimConfig();
    cfg.ticks = 7;
    cfg.agentCounts = { bigco: 2, academic: 1, smb: 0, solo: 0 };
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: cfg.seed, policyMode: "heuristic" },
      decide: (_w: WorldState, a: AgentState) => heuristicPolicy(a, _w),
    });
    expect(result.history).toHaveLength(7);
    expect(result.manifest.config.ticks).toBe(7);
  });

  it("runs with zero agents without throwing", () => {
    const cfg = defaultSimConfig();
    cfg.agentCounts = { bigco: 0, academic: 0, smb: 0, solo: 0 };
    cfg.ticks = 3;
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: 1, policyMode: "heuristic" },
      decide: () => "idle",
    });
    expect(result.history).toHaveLength(3);
    expect(result.finalWorld.agents).toHaveLength(0);
  });

  it("snapshots align with final wealth after last tick", () => {
    const cfg = defaultSimConfig();
    cfg.ticks = 5;
    cfg.agentCounts = { bigco: 1, academic: 1, smb: 0, solo: 0 };
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: cfg.seed, policyMode: "heuristic" },
      decide: (_w: WorldState, a: AgentState) => heuristicPolicy(a, _w),
    });
    const last = result.history[result.history.length - 1]!;
    const bySnap = new Map(last.agentSnapshots.map((s) => [s.id, s.wealth]));
    for (const ag of result.finalWorld.agents) {
      expect(bySnap.get(ag.id)).toBeCloseTo(ag.wealth, 8);
    }
  });

  it("each tick record includes edges array", () => {
    const cfg = defaultSimConfig();
    cfg.ticks = 2;
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: cfg.seed, policyMode: "heuristic" },
      decide: () => "idle",
    });
    expect(result.history.every((h) => Array.isArray(h.edges))).toBe(true);
  });
});

describe("createWorld", () => {
  it("initializes tick at 0", () => {
    const w = createWorld(defaultSimConfig());
    expect(w.tick).toBe(0);
  });
});
