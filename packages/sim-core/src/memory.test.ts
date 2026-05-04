import { describe, expect, it } from "vitest";
import type { AgentState } from "./types.js";
import { pushMemory } from "./memory.js";

function fakeAgent(): AgentState {
  return {
    id: "a1",
    type: "solo",
    civicRole: "citizen",
    publicServantFireable: true,
    wealth: 10,
    knowledge: 1,
    labor: 1,
    patentExpiresAt: [],
    reputation: 1,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    lastOfferingQuality: 1,
  };
}

describe("pushMemory", () => {
  it("drops oldest events when exceeding maxSlots", () => {
    const agent = fakeAgent();
    const rnd = () => 1;
    for (let i = 0; i < 5; i++) {
      pushMemory(agent, i, `e${i}`, 3, 0, rnd);
    }
    expect(agent.memory.map((m) => m.summary)).toEqual(["e2", "e3", "e4"]);
  });

  it("applies probabilistic decay after capping", () => {
    const agent = fakeAgent();
    const alwaysDrop = () => 0;
    pushMemory(agent, 0, "x", 10, 0.5, alwaysDrop);
    expect(agent.memory.length).toBeLessThanOrEqual(1);
  });

  it("keeps all entries when decay probability is 0", () => {
    const agent = fakeAgent();
    const rnd = () => 0.5;
    pushMemory(agent, 1, "a", 5, 0, rnd);
    pushMemory(agent, 2, "b", 5, 0, rnd);
    expect(agent.memory).toHaveLength(2);
  });
});
