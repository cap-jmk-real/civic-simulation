import { defaultSimConfig, heuristicPolicy, runSimulationSync, type AgentState, type WorldState } from "@ip-sim/core";
import { describe, expect, it } from "vitest";
import { fullRunJsonForLabTrialPersist } from "./labTrialFullRunPersist";

describe("fullRunJsonForLabTrialPersist", () => {
  it("returns serialized JSON when history is non-empty", () => {
    const cfg = { ...defaultSimConfig(), ticks: 3 };
    const run = runSimulationSync({
      config: cfg,
      manifest: { seed: cfg.seed, policyMode: "heuristic" as const },
      decide: (_w: WorldState, agent: AgentState) => heuristicPolicy(agent, _w),
    });
    const json = fullRunJsonForLabTrialPersist(run);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!) as { history?: unknown[] };
    expect(Array.isArray(parsed.history)).toBe(true);
    expect(parsed.history!.length).toBeGreaterThan(0);
  });

  it("returns null for empty history", () => {
    const run = {
      manifest: { schemaVersion: 1, seed: 1, policyMode: "heuristic" as const, config: defaultSimConfig() },
      history: [],
    };
    const json = fullRunJsonForLabTrialPersist(run as unknown as Parameters<typeof fullRunJsonForLabTrialPersist>[0]);
    expect(json).toBeNull();
  });
});
