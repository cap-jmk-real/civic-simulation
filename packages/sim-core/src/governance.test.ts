import { describe, expect, it } from "vitest";
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld, runSimulationSync } from "./engine.js";
import { heuristicPolicy } from "./policies/heuristic.js";
import type { AgentState, WorldState } from "./types.js";
import { isGovernanceMaintenanceTick } from "./governance.js";
import { computeTickMetrics } from "./metrics.js";
import { mulberry32 } from "./rng.js";

describe("governance", () => {
  it("isGovernanceMaintenanceTick respects cadence", () => {
    const g = defaultSimConfig().governance;
    expect(isGovernanceMaintenanceTick({ ...g, enabled: true, electionPeriodTicks: 5 }, 0)).toBe(
      false,
    );
    expect(isGovernanceMaintenanceTick({ ...g, enabled: true, electionPeriodTicks: 5 }, 5)).toBe(
      true,
    );
    expect(isGovernanceMaintenanceTick({ ...g, enabled: false, electionPeriodTicks: 5 }, 5)).toBe(
      false,
    );
  });

  it("partitions initial population into bands when enabled", () => {
    const cfg = mergeSimConfig({
      agentCounts: { bigco: 3, academic: 0, smb: 0, solo: 0 },
      governance: {
        ...defaultSimConfig().governance,
        enabled: true,
        politicianSeats: 1,
        fireableServantTarget: 1,
        tenuredServantTarget: 1,
        electionPeriodTicks: 20,
      },
    });
    const w = createWorld(cfg);
    expect(w.agents.filter((a) => a.civicRole === "politician")).toHaveLength(1);
    expect(
      w.agents.filter((a) => a.civicRole === "public_servant" && a.publicServantFireable),
    ).toHaveLength(1);
    expect(
      w.agents.filter((a) => a.civicRole === "public_servant" && !a.publicServantFireable),
    ).toHaveLength(1);
    expect(w.agents.filter((a) => a.civicRole === "citizen")).toHaveLength(0);
  });

  it("leaves everyone as citizens when disabled", () => {
    const w = createWorld(defaultSimConfig());
    expect(w.agents.every((a) => a.civicRole === "citizen")).toBe(true);
    const last = runSimulationSync({
      config: mergeSimConfig({ ticks: 2 }),
      manifest: { seed: 1, policyMode: "heuristic" },
      decide: (_world: WorldState, a: AgentState) => heuristicPolicy(a, _world),
    }).history.at(-1)!;
    expect(last.metrics.civicCitizenCount).toBe(w.agents.length);
    expect(last.metrics.civicPoliticianCount).toBe(0);
  });

  it("after maintenance, politician count matches seats and civic buckets sum to population", () => {
    const cfg = mergeSimConfig({
      agentCounts: { bigco: 8, academic: 0, smb: 0, solo: 0 },
      governance: {
        ...defaultSimConfig().governance,
        enabled: true,
        electionPeriodTicks: 2,
        politicianSeats: 2,
        electionReputationNoise: 0,
        fireableServantTarget: 2,
        tenuredServantTarget: 1,
        tenureMinReputation: 0,
        hireBlendReputation: 1,
        hireBlendKnowledge: 0,
      },
    });
    const world = createWorld(cfg);
    const idle = Object.fromEntries(world.agents.map((a) => [a.id, "idle" as const]));
    for (let step = 0; step < 2; step++) {
      const rnd = mulberry32(cfg.seed + step * 9973 + world.tick * 37);
      applyStep(world, { actions: idle, rnd });
    }
    expect(world.tick).toBe(2);
    const m = computeTickMetrics(world, 0);
    const n = world.agents.length;
    expect(m.civicPoliticianCount).toBe(2);
    expect(
      m.civicCitizenCount +
        m.civicPoliticianCount +
        m.civicPublicServantFireableCount +
        m.civicPublicServantTenuredCount,
    ).toBe(n);
    expect(m.civicPublicServantFireableCount).toBeLessThanOrEqual(2);
    expect(m.civicPublicServantTenuredCount).toBe(1);
  });
});
