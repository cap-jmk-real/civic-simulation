import type { AgentState, Edge } from "@ip-sim/core";
import type { Force } from "d3-force";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";

interface SimNode {
  id: string;
  type: AgentState["type"];
  wealth: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  index?: number;
}

/** Deterministic force layout (same algorithm as the interactive graph). */
export function computeForceLayout(
  agents: AgentState[],
  edges: Edge[],
  width: number,
  height: number,
): Record<string, { x: number; y: number }> {
  if (agents.length === 0) return {};

  const nodes: SimNode[] = agents.map((a) => ({
    id: a.id,
    type: a.type,
    wealth: a.wealth,
  }));
  const idToIdx = new Map(nodes.map((n, i) => [n.id, i] as const));
  const links = edges
    .map((e) => {
      const s = idToIdx.get(e.a);
      const t = idToIdx.get(e.b);
      if (s === undefined || t === undefined) return null;
      return { source: s, target: t, value: e.weight };
    })
    .filter(Boolean) as { source: number; target: number; value: number }[];

  const cx = width / 2;
  const cy = height / 2;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    n.x = cx + Math.cos(angle) * (width * 0.22);
    n.y = cy + Math.sin(angle) * (height * 0.22);
  });

  const linkForce = forceLink(links).distance(48).strength(0.4);
  const sim = forceSimulation(nodes as SimNode[])
    .force("link", linkForce as Force<SimNode, undefined>)
    .force("charge", forceManyBody().strength(-140))
    .force("center", forceCenter(cx, cy))
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => 7 + Math.sqrt(Math.max(0, d.wealth)) * 0.24)
        .strength(0.85),
    )
    .stop();

  const iterations = nodes.length > 150 ? 220 : 420;
  for (let i = 0; i < iterations; i++) sim.tick();

  const next: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    if (n.x !== undefined && n.y !== undefined) {
      next[n.id] = { x: n.x, y: n.y };
    }
  }
  return next;
}
