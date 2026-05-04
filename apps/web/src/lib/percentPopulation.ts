import type { SimConfig } from "@ip-sim/core";

/** Economic cohort keys whose counts define the initial population mix. */
export type PopulationAgentKey = keyof SimConfig["agentCounts"];

export const POPULATION_AGENT_KEYS: PopulationAgentKey[] = [
  "bigco",
  "academic",
  "smb",
  "solo",
];

/** One decimal place of % (e.g. 25.3% → 253). Four values always sum to 1000 (= 100.0%). */
export type PopulationPctTenths = Record<PopulationAgentKey, number>;

/** Per-field dirty flags: autofill only adjusts keys where `dirty[k] === false`. */
export type PopulationPctDirty = Record<PopulationAgentKey, boolean>;

export function freshPopulationPctDirty(): PopulationPctDirty {
  return { bigco: false, academic: false, smb: false, solo: false };
}

const KEY_ORDER: PopulationAgentKey[] = [...POPULATION_AGENT_KEYS];

function sumWeights(w: Record<PopulationAgentKey, number>): number {
  let s = 0;
  for (const k of KEY_ORDER) s += Math.max(0, w[k]);
  return s;
}

/**
 * Hamilton / largest-remainder apportionment: map a total integer `n` and non-negative
 * weights (not required to sum to 1) to integer counts that **sum exactly to `n`**.
 *
 * Each key receives floor(n * w[k] / sumW) plus extra +1 in order of **largest fractional
 * remainder** `(n * w[k] / sumW) - floor(...)`, breaking ties by **larger weight `w[k]`**,
 * then stable cohort order bigco → academic → smb → solo.
 *
 * This is the standard Hamilton method used for proportional seat allocation; it is a
 * defensible, deterministic way to absorb rounding error so counts match the planned total N.
 */
export function hamiltonAllocateCountsFromWeights(
  n: number,
  weights: Record<PopulationAgentKey, number>,
): SimConfig["agentCounts"] {
  const N = Math.max(0, Math.floor(n));
  const w: Record<PopulationAgentKey, number> = {
    bigco: Math.max(0, weights.bigco),
    academic: Math.max(0, weights.academic),
    smb: Math.max(0, weights.smb),
    solo: Math.max(0, weights.solo),
  };
  const sumW = sumWeights(w);
  if (sumW <= 0) {
    const base = Math.floor(N / 4);
    let rem = N - base * 4;
    const out = { bigco: base, academic: base, smb: base, solo: base };
    for (const k of KEY_ORDER) {
      if (rem <= 0) break;
      out[k]++;
      rem--;
    }
    return out;
  }

  const ideal: Record<PopulationAgentKey, number> = {
    bigco: (N * w.bigco) / sumW,
    academic: (N * w.academic) / sumW,
    smb: (N * w.smb) / sumW,
    solo: (N * w.solo) / sumW,
  };
  const floorC: Record<PopulationAgentKey, number> = {
    bigco: Math.floor(ideal.bigco),
    academic: Math.floor(ideal.academic),
    smb: Math.floor(ideal.smb),
    solo: Math.floor(ideal.solo),
  };
  let slack =
    N - (floorC.bigco + floorC.academic + floorC.smb + floorC.solo);

  type Row = { k: PopulationAgentKey; rem: number; w: number };
  const rows: Row[] = KEY_ORDER.map((k) => ({
    k,
    rem: ideal[k] - floorC[k],
    w: w[k],
  }));
  rows.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (b.w !== a.w) return b.w - a.w;
    return KEY_ORDER.indexOf(a.k) - KEY_ORDER.indexOf(b.k);
  });

  const out = { ...floorC };
  for (let i = 0; i < rows.length && slack > 0; i++) {
    out[rows[i]!.k]++;
    slack--;
  }
  return out;
}

/** Convert display % (0.1 step) to internal tenths (sum 1000). */
export function percentageToTenths(percentage: number): number {
  return Math.round(percentage * 10);
}

export function tenthsToPercentage(tenths: number): number {
  return tenths / 10;
}

/**
 * Encode current integer agent counts as percentage tenths summing to 1000, using the same
 * Hamilton logic in “quota = 1000” space so the UI can round-trip counts → % → counts at the
 * same N.
 */
export function countsToPctTenths(counts: SimConfig["agentCounts"]): PopulationPctTenths {
  const N =
    counts.bigco + counts.academic + counts.smb + counts.solo;
  if (N <= 0) {
    return { bigco: 250, academic: 250, smb: 250, solo: 250 };
  }
  const w = counts;
  const ideal: Record<PopulationAgentKey, number> = {
    bigco: (1000 * w.bigco) / N,
    academic: (1000 * w.academic) / N,
    smb: (1000 * w.smb) / N,
    solo: (1000 * w.solo) / N,
  };
  const floorC: Record<PopulationAgentKey, number> = {
    bigco: Math.floor(ideal.bigco),
    academic: Math.floor(ideal.academic),
    smb: Math.floor(ideal.smb),
    solo: Math.floor(ideal.solo),
  };
  let slack = 1000 - (floorC.bigco + floorC.academic + floorC.smb + floorC.solo);
  type Row = { k: PopulationAgentKey; rem: number; w: number };
  const rows: Row[] = KEY_ORDER.map((k) => ({
    k,
    rem: ideal[k] - floorC[k],
    w: w[k],
  }));
  rows.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (b.w !== a.w) return b.w - a.w;
    return KEY_ORDER.indexOf(a.k) - KEY_ORDER.indexOf(b.k);
  });
  const out = { ...floorC };
  for (let i = 0; i < rows.length && slack > 0; i++) {
    out[rows[i]!.k]++;
    slack--;
  }
  return out;
}

/** Integer agent counts for planned total N from percentage tenths (weights). */
export function pctTenthsToAgentCounts(
  tenths: PopulationPctTenths,
  plannedTotal: number,
): SimConfig["agentCounts"] {
  return hamiltonAllocateCountsFromWeights(plannedTotal, tenths);
}

/**
 * User edited one percentage (in tenths). The edited field becomes dirty. Remaining mass
 * (1000 − fixed tenths on dirty fields) is assigned to **clean** fields only, proportional
 * to their previous tenths (Hamilton in that subspace). If there are no clean fields, the
 * slack is split among the non-edited keys proportionally to their current tenths so the
 * row still sums to 1000.
 */
export function rebalancePctTenthsAfterFieldEdit(input: {
  current: PopulationPctTenths;
  dirty: PopulationPctDirty;
  editedKey: PopulationAgentKey;
  /** New value for editedKey in tenths (0–1000). */
  newTenthsRaw: number;
}): { tenths: PopulationPctTenths; dirty: PopulationPctDirty } {
  const { current, dirty, editedKey, newTenthsRaw } = input;
  const dirtyNext: PopulationPctDirty = { ...dirty, [editedKey]: true };

  const clamp01k = (t: number) => Math.max(0, Math.min(1000, Math.round(t)));

  const p: PopulationPctTenths = { ...current };
  p[editedKey] = clamp01k(newTenthsRaw);

  const otherDirtyKeys = KEY_ORDER.filter((k) => k !== editedKey && dirtyNext[k]);
  let sumOtherDirty = 0;
  for (const k of otherDirtyKeys) sumOtherDirty += clamp01k(current[k]);

  let maxEdited = 1000 - sumOtherDirty;
  if (maxEdited < 0) maxEdited = 0;
  p[editedKey] = Math.min(p[editedKey], maxEdited);

  let remaining = 1000 - p[editedKey] - sumOtherDirty;

  const cleanKeys = KEY_ORDER.filter((k) => !dirtyNext[k]);

  if (cleanKeys.length > 0 && remaining >= 0) {
    const subW: Record<PopulationAgentKey, number> = {
      bigco: 0,
      academic: 0,
      smb: 0,
      solo: 0,
    };
    let subSum = 0;
    for (const k of cleanKeys) {
      subW[k] = Math.max(0, current[k]);
      subSum += subW[k];
    }
    if (subSum <= 0) {
      const base = Math.floor(remaining / cleanKeys.length);
      let r = remaining - base * cleanKeys.length;
      for (const k of cleanKeys) {
        p[k] = base + (r > 0 ? 1 : 0);
        if (r > 0) r--;
      }
    } else {
      const subHam = hamiltonAllocateCountsFromWeights(remaining, subW);
      for (const k of cleanKeys) p[k] = subHam[k];
    }
  } else {
    const others = KEY_ORDER.filter((k) => k !== editedKey);
    const subW: Record<PopulationAgentKey, number> = {
      bigco: 0,
      academic: 0,
      smb: 0,
      solo: 0,
    };
    let subSum = 0;
    for (const k of others) {
      subW[k] = Math.max(0, current[k]);
      subSum += subW[k];
    }
    if (subSum <= 0) {
      const base = Math.floor(remaining / others.length);
      let r = remaining - base * others.length;
      for (const k of others) {
        p[k] = base + (r > 0 ? 1 : 0);
        if (r > 0) r--;
      }
    } else {
      const subHam = hamiltonAllocateCountsFromWeights(remaining, subW);
      for (const k of others) p[k] = subHam[k];
    }
  }

  return { tenths: p, dirty: dirtyNext };
}
