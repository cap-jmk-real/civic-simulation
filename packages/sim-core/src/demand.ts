/**
 * Market demand: **edge logit** (default) vs **contest legacy**.
 * See `SIMULATION_MATH.md` §5.3–5.5.
 */

import type { AgentState, Edge, PatentRegime, SimConfig } from "./types.js";

function regimePatentMult(regime: PatentRegime): number {
  if (regime === "strong") return 1.35;
  if (regime === "weak") return 1.12;
  return 1;
}

function softmaxProbs(utilities: number[], tau: number): number[] {
  const t = Math.max(1e-9, tau);
  const mx = Math.max(...utilities);
  const exps = utilities.map((u) => Math.exp((u - mx) / t));
  const s = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / s);
}

function buildAdj(agents: AgentState[], edges: Edge[]): Map<string, { id: string; w: number }[]> {
  const m = new Map<string, { id: string; w: number }[]>();
  for (const a of agents) m.set(a.id, []);
  for (const e of edges) {
    if (e.a === e.b) continue;
    m.get(e.a)!.push({ id: e.b, w: e.weight });
    m.get(e.b)!.push({ id: e.a, w: e.weight });
  }
  return m;
}

function computeBaseRevenuesContestLegacy(
  agents: AgentState[],
  marketSize: number,
  globalPool: number,
  shares: number[],
  sumW: number,
  patentRegime: PatentRegime,
  regimePatentMultVal: number,
  rnd: () => number,
): number[] {
  const nAg = agents.length;
  const baseRevenues: number[] = [];
  for (let i = 0; i < nAg; i++) {
    const ag = agents[i];
    const share = shares[i] / sumW;
    let baseRev = share * marketSize;
    const license =
      ag.patentExpiresAt.length *
      (5 + rnd() * 4) *
      regimePatentMultVal *
      (patentRegime === "none" ? 0 : 1);
    baseRev += license;
    if (patentRegime === "none") {
      baseRev *= 0.92 + globalPool * 0.0015;
    }
    baseRevenues.push(baseRev);
  }
  return baseRevenues;
}

function computeBaseRevenuesEdgeLogit(
  agents: AgentState[],
  edges: Edge[],
  cfg: SimConfig,
  marketSize: number,
  globalPool: number,
  shares: number[],
  sumW: number,
  qualities: number[],
  patentRegime: PatentRegime,
  regimePatentMultVal: number,
  rnd: () => number,
): number[] {
  const n = agents.length;
  if (n === 0) return [];

  const idToIdx = new Map(agents.map((a, i) => [a.id, i] as const));
  const adj = buildAdj(agents, edges);
  const incoming = new Array(n).fill(0);

  const tau = cfg.edgeLogitTemperature;
  const uq = cfg.edgeLogitUtilityQuality;
  const ur = cfg.edgeLogitUtilityReputation;
  const uk = cfg.edgeLogitUtilityKnowledge;
  const ew = cfg.edgeLogitEdgeWeightScale;
  const pn = cfg.edgeLogitPreferenceNoise;

  for (let i = 0; i < n; i++) {
    const ai = agents[i];
    const Bi = marketSize * (shares[i] / sumW);
    const nbs = adj.get(ai.id) ?? [];

    const candidates: number[] = [i];
    const seen = new Set<number>([i]);
    for (const { id } of nbs) {
      const j = idToIdx.get(id);
      if (j === undefined || seen.has(j)) continue;
      seen.add(j);
      candidates.push(j);
    }

    const utilities = candidates.map((j) => {
      const ag = agents[j];
      const q = qualities[j];
      let u =
        uq * Math.log(q + 1e-9) +
        ur * ag.reputation +
        uk * Math.log(ag.knowledge + 1e-9);
      if (j !== i) {
        const ed = nbs.find((x) => x.id === ag.id);
        const ww = ed?.w ?? 1;
        u *= 1 + ww * ew;
      }
      if (pn > 0) u += (rnd() - 0.5) * 2 * pn;
      return u;
    });

    const probs = softmaxProbs(utilities, tau);
    for (let k = 0; k < candidates.length; k++) {
      incoming[candidates[k]] += Bi * probs[k];
    }
  }

  const baseRevenues = incoming.map((r, j) => {
    const ag = agents[j];
    const license =
      ag.patentExpiresAt.length *
      (5 + rnd() * 4) *
      regimePatentMultVal *
      (patentRegime === "none" ? 0 : 1);
    let b = r + license;
    if (patentRegime === "none") {
      b *= 0.92 + globalPool * 0.0015;
    }
    return b;
  });

  return baseRevenues;
}

/**
 * Per-agent base revenue (before CES multipliers): either contest pool or edge-logit network demand.
 */
export function computeBaseRevenues(
  agents: AgentState[],
  edges: Edge[],
  cfg: SimConfig,
  marketSize: number,
  globalPool: number,
  shares: number[],
  sumW: number,
  qualities: number[],
  patentRegime: PatentRegime,
  rnd: () => number,
): number[] {
  const regimePatentMultVal = regimePatentMult(patentRegime);
  if (cfg.demandModel === "contest_legacy") {
    return computeBaseRevenuesContestLegacy(
      agents,
      marketSize,
      globalPool,
      shares,
      sumW,
      patentRegime,
      regimePatentMultVal,
      rnd,
    );
  }
  return computeBaseRevenuesEdgeLogit(
    agents,
    edges,
    cfg,
    marketSize,
    globalPool,
    shares,
    sumW,
    qualities,
    patentRegime,
    regimePatentMultVal,
    rnd,
  );
}
