import { describe, expect, it } from "vitest";
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";
import { createWorld } from "./engine.js";
import { buildObservation } from "./observe.js";

describe("buildObservation", () => {
  it("includes policy, regulatory snapshot, and agent fields", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({
      regulatory: { ...d.regulatory, enabled: true },
      policy: { ...d.policy, regulatoryAmbition: 0.7 },
    });
    const world = createWorld(cfg);
    const agent = world.agents[0]!;
    const o = buildObservation(agent, world);
    expect(o.selfId).toBe(agent.id);
    expect(o.type).toBe(agent.type);
    expect(o.civicRole).toBe("citizen");
    expect(o.publicServantFireable).toBe(true);
    expect(o.policy.regulatoryAmbition).toBeCloseTo(0.7, 6);
    expect(o.regulatory.enabled).toBe(true);
    expect(o.regulatory.bribeEnabled).toBe(cfg.regulatory.bribe.enabled);
    expect(o.regulatory.effectiveStringency).toBeGreaterThanOrEqual(0);
    expect(o.regulatory.effectiveStringency).toBeLessThanOrEqual(1);
    expect(o.pendingInnovationCount).toBe(0);
    expect(o.population).toBe(world.agents.length);
    expect(o.spawn.maxAgents).toBe(cfg.spawn.maxAgents);
    expect(o.spawn.enabled).toBe(cfg.spawn.enabled);
  });
});
