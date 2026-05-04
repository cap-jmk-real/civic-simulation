import type { AgentState, Edge } from "@ip-sim/core";

const MAX_NODES = 200;

/** Deterministic subsample for interactive layout when N is large. */
export function subsampleGraphForLayout(
  agents: AgentState[],
  edges: Edge[],
  seed: number,
): {
  agents: AgentState[];
  edges: Edge[];
  sampled: boolean;
  totalAgents: number;
} {
  const totalAgents = agents.length;
  if (totalAgents <= MAX_NODES) {
    return { agents, edges, sampled: false, totalAgents };
  }

  const rnd = mulberry32(seed);
  const order = agents.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const picked = new Set(order.slice(0, MAX_NODES).map((i) => agents[i]!.id));

  const subAgents = agents.filter((a) => picked.has(a.id));
  const subEdges = edges.filter((e) => picked.has(e.a) && picked.has(e.b));

  return {
    agents: subAgents,
    edges: subEdges,
    sampled: true,
    totalAgents,
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
