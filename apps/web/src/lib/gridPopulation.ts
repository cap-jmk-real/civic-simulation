import type { SimConfig } from "@ip-sim/core";
import { mulberry32 } from "@ip-sim/core";

export type GridPopulationMode =
  | "sidebar"
  | "custom_shares"
  | "fixedN_random_types"
  | "fully_random";

const TYPES = ["bigco", "academic", "smb", "solo"] as const;

export type AgentCounts = SimConfig["agentCounts"];

/**
 * Hamilton / largest-remainder apportionment: floor quotas, then give each leftover agent to the
 * index with greatest fractional part; ties → higher raw weight, then bigco→solo index order.
 */
export function allocateCountsFromWeights(
  total: number,
  weights: readonly [number, number, number, number],
): AgentCounts {
  const t = Math.max(0, Math.floor(total));
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (t === 0) {
    return { bigco: 0, academic: 0, smb: 0, solo: 0 };
  }
  if (sum <= 0) {
    const base = Math.floor(t / 4);
    let r = t - base * 4;
    const c = [base, base, base, base];
    for (let i = 0; i < r; i++) c[i]++;
    return {
      bigco: c[0]!,
      academic: c[1]!,
      smb: c[2]!,
      solo: c[3]!,
    };
  }
  const exact = w.map((wi) => (t * wi) / sum);
  const floors = exact.map((x) => Math.floor(x));
  let rem = t - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x), wi: w[i] ?? 0 }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      if (b.wi !== a.wi) return b.wi - a.wi;
      return a.i - b.i;
    });
  const out = [...floors];
  for (let k = 0; k < rem; k++) {
    const idx = order[k]!.i;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return {
    bigco: out[0]!,
    academic: out[1]!,
    smb: out[2]!,
    solo: out[3]!,
  };
}

/** Uniform Dirichlet (stick-breaking): random nonnegative weights → normalized counts. */
export function randomCountsFromRng(total: number, rnd: () => number): AgentCounts {
  const t = Math.max(0, Math.floor(total));
  if (t === 0) return { bigco: 0, academic: 0, smb: 0, solo: 0 };
  const raw = TYPES.map(() => -Math.log(Math.max(1e-12, rnd()))) as [
    number,
    number,
    number,
    number,
  ];
  return allocateCountsFromWeights(t, raw);
}

export function randomIntInclusive(min: number, max: number, rnd: () => number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi < lo) return lo;
  return lo + Math.floor(rnd() * (hi - lo + 1));
}

/** Deterministic salt per grid coordinate for reproducible per-cell populations. */
export function gridCellSeed(baseSeed: number, rowIndex: number, colIndex: number): number {
  return Math.imul(baseSeed ^ 0x9e3779b9, 31) + rowIndex * 1_000_003 + colIndex * 9_001;
}

export function agentCountsForGridCell(options: {
  mode: GridPopulationMode;
  baseCounts: AgentCounts;
  gridTotal: number;
  /** Display / user weights — any nonnegative, normalized inside allocateCountsFromWeights */
  shareWeights: readonly [number, number, number, number];
  randomMinN: number;
  randomMaxN: number;
  baseSeed: number;
  rowIndex: number;
  colIndex: number;
}): AgentCounts {
  const {
    mode,
    baseCounts,
    gridTotal,
    shareWeights,
    randomMinN,
    randomMaxN,
    baseSeed,
    rowIndex,
    colIndex,
  } = options;

  switch (mode) {
    case "sidebar":
      return { ...baseCounts };
    case "custom_shares":
      return allocateCountsFromWeights(gridTotal, shareWeights);
    case "fixedN_random_types": {
      const rnd = mulberry32(gridCellSeed(baseSeed, rowIndex, colIndex));
      return randomCountsFromRng(gridTotal, rnd);
    }
    case "fully_random": {
      const rnd = mulberry32(gridCellSeed(baseSeed, rowIndex, colIndex));
      const n = randomIntInclusive(randomMinN, randomMaxN, rnd);
      return randomCountsFromRng(n, rnd);
    }
    default:
      return { ...baseCounts };
  }
}

export function formatCountsShort(c: AgentCounts): string {
  return `${c.bigco}/${c.academic}/${c.smb}/${c.solo}`;
}

export function countsToShareWeights(c: AgentCounts): [number, number, number, number] {
  const t = c.bigco + c.academic + c.smb + c.solo;
  if (t <= 0) return [1, 1, 1, 1];
  return [
    (100 * c.bigco) / t,
    (100 * c.academic) / t,
    (100 * c.smb) / t,
    (100 * c.solo) / t,
  ];
}
