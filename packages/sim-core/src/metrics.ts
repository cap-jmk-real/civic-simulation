import type { AgentState, Edge, TickMetrics, WorldState } from "./types.js";

/**
 * Gini coefficient of nonnegative values (0 = perfect equality, 1 = maximum inequality).
 * Non-finite entries are dropped; if all mass is zero, returns 0.
 */
export function gini(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i];
  if (sum === 0) return 0;
  let num = 0;
  for (let i = 0; i < n; i++) num += (2 * i - n + 1) * v[i];
  return num / (n * sum);
}

/**
 * Herfindahl–Hirschman index: sum of squared *normalized* shares.
 * @param shares — Raw nonnegative weights; normalized by their sum before squaring.
 */
export function hhi(shares: number[]): number {
  const s = shares.reduce((a, b) => a + b, 0);
  if (s === 0) return 0;
  let h = 0;
  for (const x of shares) {
    const p = x / s;
    h += p * p;
  }
  return h;
}

/**
 * Totals and top-concentration for a nonnegative stock (wealth, reputation, etc.).
 * `top10` / `top1` use count-based cutoffs (10% / 1% of agents by rank), not fixed dollar amounts.
 */
export function stockDistribution(values: number[]): {
  total: number;
  top10Sum: number;
  top1Sum: number;
  gini: number;
  top10Share: number;
} {
  const total = values.reduce((s, x) => s + x, 0);
  const sorted = [...values].sort((a, b) => b - a);
  const n = sorted.length;
  const k10 = Math.max(1, Math.ceil(n * 0.1));
  const k1 = n === 0 ? 0 : Math.max(1, Math.ceil(n * 0.01));
  const top10Sum = sorted.slice(0, k10).reduce((s, x) => s + x, 0);
  const top1Sum = n === 0 ? 0 : sorted.slice(0, k1).reduce((s, x) => s + x, 0);
  return {
    total,
    top10Sum,
    top1Sum,
    gini: gini(values),
    top10Share: total > 0 ? top10Sum / total : 0,
  };
}

function neighborCounts(
  agents: AgentState[],
  edges: Edge[],
): Record<string, number> {
  const d: Record<string, number> = {};
  for (const a of agents) d[a.id] = 0;
  for (const e of edges) {
    d[e.a] = (d[e.a] ?? 0) + 1;
    d[e.b] = (d[e.b] ?? 0) + 1;
  }
  return d;
}

/**
 * Per-agent competitive “weights” used to split the market in the engine.
 * Combines type weight, knowledge (with graph spillover), patent count, reputation, and degree.
 * Returns one positive number per agent (not yet normalized to sum to 1).
 */
export function computeMarketShares(
  agents: AgentState[],
  edges: Edge[],
  weightsByType: Record<AgentState["type"], number>,
  capabilityBeta: number,
  spilloverAlpha: number,
): number[] {
  const deg = neighborCounts(agents, edges);
  return agents.map((ag) => {
    const spill = spilloverFromGraph(ag.id, edges, agents, spilloverAlpha);
    const cap = Math.pow(ag.knowledge + spill, capabilityBeta);
    const patentBoost = 1 + 0.12 * ag.patentExpiresAt.length;
    const rep = 1 + 0.05 * ag.reputation;
    const w =
      weightsByType[ag.type] * cap * patentBoost * rep * (1 + 0.02 * (deg[ag.id] ?? 0));
    return Math.max(1e-6, w);
  });
}

function spilloverFromGraph(
  id: string,
  edges: Edge[],
  agents: AgentState[],
  alpha: number,
): number {
  let s = 0;
  const map = new Map<string, number>();
  for (const e of edges) {
    if (e.a === id) map.set(e.b, (map.get(e.b) ?? 0) + e.weight);
    else if (e.b === id) map.set(e.a, (map.get(e.a) ?? 0) + e.weight);
  }
  const byId = new Map(agents.map((a) => [a.id, a] as const));
  for (const [nid, w] of map) {
    const o = byId.get(nid);
    if (o) s += w * o.knowledge;
  }
  return alpha * s;
}

/**
 * Aggregate {@link TickMetrics} at the *end* of a tick: wealth/reputation distribution,
 * market and “power” concentration, knowledge stock, global pool, and the passed `innovationFlow`.
 */
export function computeTickMetrics(
  world: WorldState,
  innovationFlow: number,
): TickMetrics {
  const agents = world.agents;
  const wealth = agents.map((a) => a.wealth);
  const repVals = agents.map((a) => a.reputation);
  const wDist = stockDistribution(wealth);
  const rDist = stockDistribution(repVals);
  const totalW = wDist.total;
  const nAgents = Math.max(1, agents.length);
  const meanWealth = totalW / nAgents;
  const top10Sum = wDist.top10Sum;
  const top1Sum = wDist.top1Sum;
  const top10WealthShare = wDist.top10Share;

  const shares = computeMarketShares(
    agents,
    world.edges,
    world.config.typeWeights,
    world.config.capabilityBeta,
    world.config.spilloverAlpha,
  );
  const msHhi = hhi(shares);

  const patentVals = agents.map((a) => a.patentExpiresAt.length);
  const patentHhi = hhi(patentVals.map((x) => x + 1e-6));

  const deg = neighborCounts(agents, world.edges);
  const degVals = agents.map((a) => deg[a.id] ?? 0);
  const degHhi = hhi(degVals.map((x) => x + 1e-6));

  const powerScores = agents.map((a, i) => {
    const ms = shares[i] / (shares.reduce((s, x) => s + x, 0) || 1);
    const pPat = (patentVals[i] + 1e-3) / (patentVals.reduce((s, x) => s + x, 0) || 1);
    const pDeg = (degVals[i] + 1e-3) / (degVals.reduce((s, x) => s + x, 0) || 1);
    return 0.45 * ms + 0.35 * pPat + 0.2 * pDeg;
  });
  const powerHHI = hhi(powerScores);

  const totalK = agents.reduce((s, a) => s + a.knowledge, 0);

  const lr = world.lastRegulatoryTick;

  let civicPoliticianCount = 0;
  let civicPublicServantFireableCount = 0;
  let civicPublicServantTenuredCount = 0;
  let civicCitizenCount = 0;
  for (const a of agents) {
    if (a.civicRole === "politician") civicPoliticianCount += 1;
    else if (a.civicRole === "public_servant") {
      if (a.publicServantFireable) civicPublicServantFireableCount += 1;
      else civicPublicServantTenuredCount += 1;
    } else civicCitizenCount += 1;
  }

  return {
    tick: world.tick,
    totalWealth: totalW,
    meanWealth,
    top10Wealth: top10Sum,
    top1PercentWealth: top1Sum,
    giniWealth: wDist.gini,
    top10WealthShare,
    totalReputation: rDist.total,
    top10Reputation: rDist.top10Sum,
    top1PercentReputation: rDist.top1Sum,
    giniReputation: rDist.gini,
    top10ReputationShare: rDist.top10Share,
    hhiMarketShare: msHhi,
    innovationFlow,
    totalKnowledgeStock: totalK,
    globalPool: world.globalPool,
    powerHHI,
    powerComponents: {
      marketShareHHI: msHhi,
      patentHHI: patentHhi,
      degreeCentralityNorm: degHhi,
    },
    regulatoryStringency: lr?.effectiveStringency ?? 0,
    regulatoryCorruption: world.regulatory.corruption,
    externalityNetLoad: lr?.netSocialLoad ?? 0,
    externalityMitigatedLoad: lr?.mitigatedLoad ?? 0,
    externalityWealthTransfer: lr?.totalWealthTransfer ?? 0,
    agentCount: agents.length,
    civicPoliticianCount,
    civicPublicServantFireableCount,
    civicPublicServantTenuredCount,
    civicCitizenCount,
  };
}
