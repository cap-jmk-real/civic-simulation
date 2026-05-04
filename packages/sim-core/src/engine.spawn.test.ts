import { describe, expect, it } from "vitest";
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";
import { applyStep, createWorld } from "./engine.js";
import type { Action } from "./types.js";

function constantRng(x: number): () => number {
  return () => x;
}

describe("spawn_agent", () => {
  it("adds an agent when enabled, under cap, and parent is wealthy enough", () => {
    const cfg = mergeSimConfig({
      spawn: {
        ...defaultSimConfig().spawn,
        enabled: true,
        maxAgents: 500,
        parentCostWealth: 10,
        minParentWealthFloor: 5,
        inheritKnowledgeFraction: 0.5,
        childType: "inherit",
        childStartWealth: 30,
        linkParentEdgeWeight: 0.5,
        parentReputationOnSuccess: 0.02,
      },
      agentCounts: { bigco: 1, academic: 0, smb: 0, solo: 0 },
    });
    const world = createWorld(cfg);
    const parent = world.agents[0]!;
    parent.wealth = 200;
    parent.knowledge = 40;
    const n0 = world.agents.length;
    const id = parent.id;
    applyStep(world, {
      actions: { [id]: "spawn_agent" } as Record<string, Action>,
      rnd: constantRng(0.3),
    });
    expect(world.agents.length).toBe(n0 + 1);
    const child = world.agents[world.agents.length - 1]!;
    expect(child.id).not.toBe(id);
    expect(child.type).toBe("bigco");
    expect(child.knowledge).toBeGreaterThanOrEqual(20);
    expect(
      world.edges.some(
        (e) =>
          (e.a === id && e.b === child.id) || (e.b === id && e.a === child.id),
      ),
    ).toBe(true);
  });

  it("no-ops at population cap", () => {
    const cfg = mergeSimConfig({
      spawn: {
        ...defaultSimConfig().spawn,
        enabled: true,
        maxAgents: 1,
        parentCostWealth: 5,
        minParentWealthFloor: 0,
      },
      agentCounts: { bigco: 1, academic: 0, smb: 0, solo: 0 },
    });
    const world = createWorld(cfg);
    world.agents[0]!.wealth = 500;
    applyStep(world, {
      actions: { [world.agents[0]!.id]: "spawn_agent" } as Record<string, Action>,
      rnd: constantRng(0.2),
    });
    expect(world.agents.length).toBe(1);
  });

  it("no-ops when disabled", () => {
    const cfg = mergeSimConfig({
      spawn: { ...defaultSimConfig().spawn, enabled: false },
      agentCounts: { bigco: 1, academic: 0, smb: 0, solo: 0 },
    });
    const world = createWorld(cfg);
    world.agents[0]!.wealth = 500;
    const n0 = world.agents.length;
    applyStep(world, {
      actions: { [world.agents[0]!.id]: "spawn_agent" } as Record<string, Action>,
      rnd: constantRng(0.2),
    });
    expect(world.agents.length).toBe(n0);
  });
});
