import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.js";
import { generateInitialEdges } from "./graph.js";
import type { AgentState } from "./types.js";

function ids(n: number): AgentState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a-${i}`,
    type: "solo" as const,
    civicRole: "citizen" as const,
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
  }));
}

describe("generateInitialEdges", () => {
  it("returns empty for fewer than two agents", () => {
    const rnd = mulberry32(1);
    expect(generateInitialEdges(ids(0), { kind: "random", avgDegree: 3 }, rnd)).toEqual([]);
    expect(generateInitialEdges(ids(1), { kind: "random", avgDegree: 3 }, rnd)).toEqual([]);
  });

  it("produces edges only between existing ids with positive weights", () => {
    const rnd = mulberry32(100);
    const agents = ids(8);
    const idSet = new Set(agents.map((a) => a.id));
    const edges = generateInitialEdges(agents, { kind: "random", avgDegree: 3 }, rnd);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(idSet.has(e.a)).toBe(true);
      expect(idSet.has(e.b)).toBe(true);
      expect(e.a).not.toBe(e.b);
      expect(e.weight).toBeGreaterThanOrEqual(0.4);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic given the same rnd stream", () => {
    const mk = () => generateInitialEdges(ids(10), { kind: "small_world", avgDegree: 3 }, mulberry32(555));
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});
