import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { runSimulationSync } from "./engine.js";
import { heuristicPolicy } from "./policies/heuristic.js";
import type { AgentState, WorldState } from "./types.js";

/**
 * Gold: final-tick `innovationFlow` must stay aligned with Rust `ip-sim-engine`
 * (`tests/sim_integration.rs`, `final_tick_innovation_flow_matches_ts_gold`) for the same config.
 */
const GOLD_CFG = {
  seed: 42,
  ticks: 30,
  agentCounts: { bigco: 2, academic: 2, smb: 2, solo: 2 },
} as const;

const EXPECTED_FINAL_INNOVATION_FLOW = 34.63692426215857;

describe("innovationFlow (final tick)", () => {
  it("is non-trivial under a fixed compact cohort (gold vs Rust)", () => {
    const cfg = mergeSimConfig({ ...GOLD_CFG });
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: 42, policyMode: "heuristic" },
      decide: (_w: WorldState, a: AgentState) => heuristicPolicy(a, _w),
    });
    const last = result.history[result.history.length - 1]!;
    expect(last.metrics.innovationFlow).toBeGreaterThan(5);
    expect(last.metrics.innovationFlow).toBeCloseTo(EXPECTED_FINAL_INNOVATION_FLOW, 10);
    expect(last.metrics.agentCount).toBe(8);
    const per = last.metrics.innovationFlow / last.metrics.agentCount;
    expect(per).toBeCloseTo(EXPECTED_FINAL_INNOVATION_FLOW / 8, 10);
  });

  it("documents expected zero: no agents and idle policy", () => {
    const cfg = mergeSimConfig({
      seed: 1,
      ticks: 3,
      agentCounts: { bigco: 0, academic: 0, smb: 0, solo: 0 },
    });
    const result = runSimulationSync({
      config: cfg,
      manifest: { seed: 1, policyMode: "heuristic" },
      decide: () => "idle",
    });
    for (const h of result.history) {
      expect(h.metrics.innovationFlow).toBe(0);
    }
  });
});
