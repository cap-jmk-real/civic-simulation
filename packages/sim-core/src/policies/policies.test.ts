import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "../defaultConfig.js";
import { createWorld, validateAction } from "../engine.js";
import { ACTIONS } from "../types.js";
import { heuristicPolicy } from "./heuristic.js";
import { qrePolicy } from "./qre.js";

describe("policy functions", () => {
  it("heuristicPolicy always returns a member of ACTIONS", () => {
    const world = createWorld(mergeSimConfig({ ticks: 5 }));
    for (const agent of world.agents) {
      const act = heuristicPolicy(agent, world);
      expect(ACTIONS.includes(act)).toBe(true);
      expect(validateAction(act)).toBe(true);
    }
  });

  it("qrePolicy always returns a member of ACTIONS", () => {
    const world = createWorld(mergeSimConfig({ ticks: 5 }));
    for (const agent of world.agents) {
      const act = qrePolicy(agent, world, { temperature: 0.55, seedSalt: 42 });
      expect(ACTIONS.includes(act)).toBe(true);
      expect(validateAction(act)).toBe(true);
    }
  });
});
