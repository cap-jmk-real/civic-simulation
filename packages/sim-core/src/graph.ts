import type { AgentState, Edge, GraphPreset } from "./types.js";
import { shuffleInPlace } from "./rng.js";

/**
 * Build an undirected collaboration graph for the initial population.
 * @param agents — Agent list (only `id` is used).
 * @param preset — Topology kind (`random`, `small_world`, `scale_free`) and target average degree.
 * @param rnd — Random source for edge choice and weights.
 * @returns Edges `{ a, b, weight }` with positive weights; empty if fewer than two agents.
 */
export function generateInitialEdges(
  agents: AgentState[],
  preset: GraphPreset,
  rnd: () => number,
): Edge[] {
  const n = agents.length;
  if (n < 2) return [];
  const ids = agents.map((a) => a.id);
  const targetDeg = Math.max(1, Math.min(Math.floor(preset.avgDegree), n - 1));
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const seen = new Set<string>();
  const edges: Edge[] = [];

  const addEdge = (a: string, b: string) => {
    const k = edgeKey(a, b);
    if (a === b || seen.has(k)) return;
    seen.add(k);
    edges.push({ a, b, weight: 0.4 + rnd() * 0.6 });
  };

  if (preset.kind === "random") {
    const m = Math.floor((n * targetDeg) / 2);
    for (let i = 0; i < m * 3; i++) {
      const a = ids[Math.floor(rnd() * n)];
      const b = ids[Math.floor(rnd() * n)];
      addEdge(a, b);
      if (edges.length >= m) break;
    }
  } else if (preset.kind === "small_world") {
    const ring: string[] = [...ids];
    shuffleInPlace(ring, rnd);
    for (let i = 0; i < n; i++) {
      for (let k = 1; k <= Math.min(2, targetDeg); k++) {
        addEdge(ring[i], ring[(i + k) % n]);
      }
    }
    // Rewire
    for (let i = 0; i < n; i++) {
      if (rnd() < 0.08) {
        const j = Math.floor(rnd() * n);
        addEdge(ring[i], ring[j]);
      }
    }
  } else {
    // scale_free preferential - simplified Barabási–Albert-like
    const stubs = [...ids];
    if (stubs.length >= 2) addEdge(stubs[0], stubs[1]);
    const degree: Record<string, number> = {};
    for (const id of ids) degree[id] = 0;
    for (const e of edges) {
      degree[e.a]++;
      degree[e.b]++;
    }
    for (let i = 2; i < n; i++) {
      const newId = ids[i];
      let tries = 0;
      while (tries < n * 2) {
        tries++;
        const pick = ids[Math.floor(rnd() * i)];
        const p = (degree[pick] + 1) / (2 * edges.length + 1);
        if (rnd() < p) {
          addEdge(newId, pick);
          degree[newId]++;
          degree[pick]++;
          break;
        }
      }
      if (!edges.some((e) => e.a === newId || e.b === newId)) {
        addEdge(newId, ids[Math.floor(rnd() * i)]);
      }
    }
  }

  return edges;
}
