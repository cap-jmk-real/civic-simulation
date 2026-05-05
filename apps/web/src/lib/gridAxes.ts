import type { PatentRegime, SimConfig } from "@ip-sim/core";
import { totalAgents } from "@/lib/populationPresets";

/** Axes match the Run configuration sidebar only (not hidden engine defaults). */
export type GridSweep =
  | { kind: "linear"; min: number; max: number }
  | { kind: "linear_int"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] };

export type GridAxisDefinition = {
  id: GridAxisId;
  label: string;
  short: string;
  category: string;
  sweep: GridSweep;
  /** Explanatory text for native tooltips in the batch sweep table (1–2 sentences). */
  description: string;
  /**
   * Optional override: sample values using current sidebar config (e.g. sweep counts around your mix).
   */
  customSample?: (steps: number, base: SimConfig) => (number | string)[];
};

export const GRID_MAX_STEPS_PER_AXIS = 48;

/** Confirm before starting batches larger than this (tab may stall). */
export const GRID_WARN_TOTAL_RUNS = 2500;

/** Absolute ceiling: factorial product cannot exceed this; user “max runs” is clamped to it. */
export const GRID_ABS_MAX_RUNS = 25_000;

/**
 * Conservative ceiling on estimated retained heap for a materialized full-factorial assignment
 * matrix (outer array + per-row arrays + `{ id, value }` cells). Materialization is refused above
 * this even when `totalRuns ≤ GRID_ABS_MAX_RUNS` so the tab is less likely to OOM from overhead.
 */
export const GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES = 120 * 1024 * 1024;

/**
 * Rough retained-size estimate for `cartesianAssignments` output (order-of-magnitude; V8 varies).
 * Use only for UX / safety gates, not accounting.
 */
export function estimateFullFactorialMaterializedBytes(rowCount: number, axisCount: number): number {
  if (rowCount <= 0 || axisCount <= 0) return 0;
  const perAssignmentObject = 120;
  const perInnerArrayOverhead = 48;
  const perOuterPointer = 8;
  const outerOverhead = 64;
  const perRow = perInnerArrayOverhead + axisCount * perAssignmentObject;
  return outerOverhead + rowCount * perOuterPointer + rowCount * perRow;
}

/**
 * Parameter-space construction for browser batches (design names in literature).
 *
 * **Full reference (formulas, seeds, caps, enum subsampling):** `docs/GRID_BATCH_MATH.md` in the repo
 * root—keep it in sync when changing `buildGridConstructionPlan`, `sampleAxisValuesWithBounds`, or
 * seed mixing. **Per-axis semantics** (what each id patches in `SimConfig` / manifest) live in
 * `GRID_AXIS_DESCRIPTIONS` + `META` below; **tick/engine economics** are documented in
 * `packages/sim-core/SIMULATION_MATH.md` (not duplicated here).
 *
 * Mode summary:
 *
 * - **Full factorial** — classical *factorial design* / Cartesian grid: every combination of discrete
 *   levels (Box–Hunter–Hunter style screening grids at full resolution).
 * - **Random sample** — *Monte Carlo* / crude Monte Carlo over the box: independent uniform draws per
 *   continuous axis; discrete axes uniform on levels (Fishman, *Monte Carlo* texts).
 * - **Latin hypercube** — *Latin hypercube sampling* (McKay, Beckman, Conover, Technometrics 1979):
 *   one stratified draw per axis per run, column permutations so projections are spread; cheap
 *   space-filling alternative to full grids. Here: unit-strata LHS on each enabled axis (including
 *   enums mapped through a unit interval), then row shuffle to reduce pairing artifacts.
 * - **One-at-a-time (OAT)** — *axial* / *path* screening (common in Morris-style local sensitivity;
 *   we use the simple axial path: baseline at the midpoint level of each axis, then vary **one**
 *   axis across its full discrete level set while others stay at baseline). Total runs = sum of
 *   level counts, not product.
 *
 * Skipped for v1: *fractional factorial* (generator/defining-relation algebra), *Sobol / QMC*
 * (would add a sequence implementation or dependency).
 */
export const GRID_CONSTRUCTION_MODES = [
  "full_factorial",
  "random_sample",
  "latin_hypercube",
  "one_at_a_time",
] as const;

export type GridConstructionMode = (typeof GRID_CONSTRUCTION_MODES)[number];

export const DEFAULT_SAMPLE_RUN_COUNT = 120;

/** Mulberry32 PRNG (fast, small). Seeded from config + salt for reproducible batches. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mix sidebar seed, construction mode, run index, and optional axis salt into a 32-bit stream seed.
 * @see docs/GRID_BATCH_MATH.md §5
 */
export function batchDrawSeed(baseSeed: number, mode: GridConstructionMode, runIndex: number, salt = 0): number {
  const s0 = (baseSeed >>> 0) ^ 0x9e3779b9;
  const s1 = (GRID_CONSTRUCTION_MODES.indexOf(mode) + 1) * 0x85ebca6b;
  const s2 = (runIndex >>> 0) * 0xc2b2ae35;
  const s3 = (salt >>> 0) * 0x27d4eb2d;
  return (s0 ^ s1 ^ s2 ^ s3) >>> 0;
}

export type AxisRunSpec = { id: GridAxisId; values: (number | string)[] };

export function sortBounds(min: number, max: number): { min: number; max: number } {
  if (Number.isFinite(min) && Number.isFinite(max) && min !== max) {
    return min <= max ? { min, max } : { min: max, max: min };
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min, max: min + 1e-9 };
}

function shuffledIndices(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

function baselineIndex(len: number): number {
  if (len <= 0) return 0;
  return Math.floor((len - 1) / 2);
}

/**
 * Map \(U \in [0,1)\) to a value on axis `def` using numeric `bounds` or enum `enumValues`.
 * Used by Monte Carlo and LHS after stratified uniforms are built (`docs/GRID_BATCH_MATH.md` §4).
 */
function unitToAxisValue(
  def: GridAxisDefinition,
  u01: number,
  bounds: { min: number; max: number },
  enumValues: readonly (number | string)[],
): number | string {
  const u = Math.min(0.999999999, Math.max(0, u01));
  if (def.sweep.kind === "enum") {
    const L = enumValues.length;
    if (L <= 0) return "";
    return enumValues[Math.min(L - 1, Math.floor(u * L))]!;
  }
  const { min, max } = bounds;
  if (def.sweep.kind === "linear_int") {
    const x = min + u * (max - min);
    return Math.round(x);
  }
  return min + u * (max - min);
}

function buildSpecsFromTable(
  enabledAxisIds: readonly GridAxisId[],
  axisTable: Readonly<Record<GridAxisId, GridAxisSweepRow>>,
): AxisRunSpec[] {
  const specs: AxisRunSpec[] = [];
  for (const id of enabledAxisIds) {
    const def = getGridAxisDefinition(id);
    const row = axisTable[id]!;
    if (def.sweep.kind === "enum") {
      specs.push({ id, values: sampleAxisValuesWithBounds(def, row.steps, { min: 0, max: 0 }) });
    } else {
      const { min, max } = sortBounds(row.min, row.max);
      const steps = clampGridAxisStepCount(row.steps);
      specs.push({ id, values: sampleAxisValuesWithBounds(def, steps, { min, max }) });
    }
  }
  return specs;
}

export function cartesianAssignments(axes: AxisRunSpec[]): GridAxisAssignment[][] {
  if (axes.length === 0) return [[]];
  const [{ id, values }, ...rest] = axes;
  const tail = cartesianAssignments(rest);
  const out: GridAxisAssignment[][] = [];
  for (const v of values) {
    for (const row of tail) {
      out.push([{ id, value: v }, ...row]);
    }
  }
  return out;
}

/**
 * Full-factorial row count from built specs (product of level list lengths).
 * Returns 0 if any axis has no levels; returns a value > `GRID_ABS_MAX_RUNS` when the true
 * product is non-finite or exceeds `Number.MAX_SAFE_INTEGER` so callers can skip materialization.
 */
export function fullFactorialRunCount(specs: AxisRunSpec[]): number {
  if (specs.length === 0) return 0;
  let p = 1;
  for (const s of specs) {
    const L = s.values.length;
    if (L <= 0) return 0;
    const n = p * L;
    if (!Number.isFinite(n) || n > Number.MAX_SAFE_INTEGER) {
      return GRID_ABS_MAX_RUNS + 1;
    }
    p = n;
  }
  return p;
}

/**
 * Build ordered assignment rows for the batch runner from construction mode.
 *
 * **Full factorial:** never materializes the Cartesian grid here — always `assignments: []` and
 * `totalRuns` from {@link fullFactorialRunCount} (including when within `GRID_ABS_MAX_RUNS`).
 * The UI should call {@link cartesianAssignments} only after explicit user confirmation so axis
 * edits do not allocate huge arrays. If the product exceeds `GRID_ABS_MAX_RUNS`, `totalRuns`
 * still reflects that product for messaging; runs stay blocked until the design is reduced.
 *
 * For non–full-factorial modes, `sampleRunCount` caps random/LHS draws (after clamping to
 * `GRID_ABS_MAX_RUNS`). Discrete level lists in `specs` still come from the sweep table (§2 in
 * `docs/GRID_BATCH_MATH.md`).
 *
 * @see docs/GRID_BATCH_MATH.md
 */
export function buildGridConstructionPlan(args: {
  mode: GridConstructionMode;
  enabledAxisIds: readonly GridAxisId[];
  axisTable: Readonly<Record<GridAxisId, GridAxisSweepRow>>;
  sampleRunCount: number;
  baseSeed: number;
}): {
  specs: AxisRunSpec[];
  assignments: GridAxisAssignment[][];
  totalRuns: number;
  levelProductLabel: string;
  heatmapEligible: boolean;
} {
  const { mode, enabledAxisIds, axisTable, baseSeed } = args;
  const specs = buildSpecsFromTable(enabledAxisIds, axisTable);

  if (specs.length === 0) {
    return { specs, assignments: [], totalRuns: 0, levelProductLabel: "—", heatmapEligible: false };
  }

  const levelParts = specs.map((s) => s.values.length);
  const levelProductLabel = levelParts.join("×");

  if (mode === "full_factorial") {
    const totalRuns = fullFactorialRunCount(specs);
    if (totalRuns === 0) {
      return { specs, assignments: [], totalRuns: 0, levelProductLabel, heatmapEligible: false };
    }
    return {
      specs,
      assignments: [],
      totalRuns,
      levelProductLabel,
      heatmapEligible: specs.length === 2,
    };
  }

  const nRaw = Math.floor(args.sampleRunCount);
  const n = Math.min(GRID_ABS_MAX_RUNS, Math.max(1, nRaw));
  const heatmapEligible = false;

  if (mode === "one_at_a_time") {
    const assignments: GridAxisAssignment[][] = [];
    for (let a = 0; a < specs.length; a++) {
      const spec = specs[a]!;
      const baseVals: GridAxisAssignment[] = specs.map((sp) => {
        const bi = baselineIndex(sp.values.length);
        return { id: sp.id, value: sp.values[bi]! };
      });
      for (const v of spec.values) {
        const row: GridAxisAssignment[] = baseVals.map((cell, j) =>
          j === a ? { id: spec.id, value: v } : cell,
        );
        assignments.push(row);
      }
    }
    return {
      specs,
      assignments,
      totalRuns: assignments.length,
      levelProductLabel: specs.map((s) => s.values.length).join("+"),
      heatmapEligible,
    };
  }

  // Random or LHS: N rows
  const dim = specs.length;
  const rngSetup = mulberry32(batchDrawSeed(baseSeed, mode, 0, 0x51ed));

  if (mode === "random_sample") {
    const assignments: GridAxisAssignment[][] = [];
    for (let i = 0; i < n; i++) {
      const rng = mulberry32(batchDrawSeed(baseSeed, mode, i, 0));
      const row: GridAxisAssignment[] = specs.map((sp) => {
        const def = getGridAxisDefinition(sp.id);
        const u = rng();
        const bounds =
          def.sweep.kind === "enum"
            ? { min: 0, max: 0 }
            : sortBounds(axisTable[sp.id]!.min, axisTable[sp.id]!.max);
        return { id: sp.id, value: unitToAxisValue(def, u, bounds, sp.values as readonly (number | string)[]) };
      });
      assignments.push(row);
    }
    return {
      specs,
      assignments,
      totalRuns: n,
      levelProductLabel: `${n} draws (${levelProductLabel} bounds)`,
      heatmapEligible,
    };
  }

  // latin_hypercube
  const rng = rngSetup;
  const uMatrix: number[][] = Array.from({ length: n }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    const perm = shuffledIndices(n, rng);
    for (let i = 0; i < n; i++) {
      const u = rng();
      uMatrix[i]![j] = (perm[i]! + u) / n;
    }
  }
  const rowOrder = shuffledIndices(n, rng);
  const assignments: GridAxisAssignment[][] = [];
  for (let r = 0; r < n; r++) {
    const i = rowOrder[r]!;
    const row: GridAxisAssignment[] = specs.map((sp, j) => {
      const def = getGridAxisDefinition(sp.id);
      const bounds =
        def.sweep.kind === "enum"
          ? { min: 0, max: 0 }
          : sortBounds(axisTable[sp.id]!.min, axisTable[sp.id]!.max);
      const u = uMatrix[i]![j]!;
      return { id: sp.id, value: unitToAxisValue(def, u, bounds, sp.values as readonly (number | string)[]) };
    });
    assignments.push(row);
  }

  return {
    specs,
    assignments,
    totalRuns: n,
    levelProductLabel: `${n} LHS (${levelProductLabel} strata/bounds)`,
    heatmapEligible,
  };
}

const ABS_MAX_STEPS_PER_AXIS = GRID_MAX_STEPS_PER_AXIS;

function linspace(min: number, max: number, steps: number): number[] {
  if (steps < 2) return [min];
  return Array.from({ length: steps }, (_, i) => min + (i / (steps - 1)) * (max - min));
}

function linspaceInt(min: number, max: number, steps: number): number[] {
  if (max <= min) return [Math.round(min)];
  if (steps < 2) return [Math.round(min)];
  const raw = linspace(min, max, steps).map((x) => Math.round(x));
  return [...new Set(raw)].sort((a, b) => a - b);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Symmetric sweep count: larger cohort / spawn cap → fewer points to keep batches tractable. */
export function autoSweepPointsPerAxis(base: SimConfig): number {
  const cohort = totalAgents(base.agentCounts);
  const cap = Math.max(cohort, base.spawn.maxAgents);
  const raw = Math.round(480 / Math.pow(Math.max(1, cap), 0.55));
  return Math.min(16, Math.max(2, raw));
}

export function effectiveAxisSteps(
  def: Pick<GridAxisDefinition, "sweep" | "customSample">,
  autoSteps: number,
): number {
  if (def.sweep.kind === "enum") return def.sweep.values.length;
  return Math.min(ABS_MAX_STEPS_PER_AXIS, Math.max(2, autoSteps));
}

export function sampleAxisValues(
  def: GridAxisDefinition,
  effSteps: number,
  base: SimConfig,
): (number | string)[] {
  if (def.customSample) return def.customSample(effSteps, base);
  if (def.sweep.kind === "enum") return [...def.sweep.values];
  if (def.sweep.kind === "linear_int")
    return linspaceInt(def.sweep.min, def.sweep.max, effSteps);
  return linspace(def.sweep.min, def.sweep.max, effSteps);
}

/** Clamp per-axis sweep resolution for numeric axes (matches internal sweep cap). */
export function clampGridAxisStepCount(steps: number): number {
  return Math.min(ABS_MAX_STEPS_PER_AXIS, Math.max(2, Math.round(steps)));
}

/**
 * Default min/max for the grid UI: span of {@link sampleAxisValues} at the effective auto step count,
 * so custom-sample axes track the sidebar the same way as the legacy 2-axis grid.
 */
export function deriveDefaultNumericBounds(
  def: GridAxisDefinition,
  base: SimConfig,
  autoSteps: number,
): { min: number; max: number } {
  if (def.sweep.kind === "enum") {
    throw new Error(`deriveDefaultNumericBounds: enum axis ${def.id}`);
  }
  const eff = effectiveAxisSteps(def, autoSteps);
  const samples = sampleAxisValues(def, eff, base);
  const nums = samples.map((s) => (typeof s === "number" ? s : Number(s))).filter((n) => Number.isFinite(n));
  if (nums.length === 0) return { min: def.sweep.min, max: def.sweep.max };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Evenly pick `targetLevels` distinct entries from an enum (endpoints included when possible). */
/** Evenly spaced index subsample; formula in `docs/GRID_BATCH_MATH.md` §2. */
export function subsampleEnumValues(
  values: readonly string[],
  targetLevels: number,
): string[] {
  const n = values.length;
  if (targetLevels >= n) return [...values];
  if (n === 0) return [];
  if (targetLevels <= 1) return [values[0]!];
  const idx = new Set<number>();
  for (let j = 0; j < targetLevels; j++) {
    idx.add(Math.round((j * (n - 1)) / Math.max(1, targetLevels - 1)));
  }
  return [...idx].sort((a, b) => a - b).map((i) => values[i]!);
}

export type GridAxisSweepRow = {
  enabled: boolean;
  min: number;
  max: number;
  /**
   * Numeric axes: step count in [2, GRID_MAX_STEPS_PER_AXIS].
   * Enum axes: how many discrete levels to include (subsampled when smaller than full list).
   */
  steps: number;
};

function axisEffectiveLevels(
  table: Record<GridAxisId, GridAxisSweepRow>,
  id: GridAxisId,
): number {
  const def = getGridAxisDefinition(id);
  const row = table[id]!;
  if (def.sweep.kind === "enum") {
    const L = def.sweep.values.length;
    return Math.min(L, Math.max(1, Math.round(row.steps)));
  }
  return clampGridAxisStepCount(row.steps);
}

function productAxisLevels(levels: readonly number[]): number {
  return levels.reduce((acc, lv) => acc * Math.max(1, lv), 1);
}

function minAchievableLevelsForAxis(def: GridAxisDefinition): number {
  if (def.sweep.kind === "enum") return 1;
  return 2;
}

/**
 * Lower per-axis resolution so the factorial product of enabled axes fits under `cap`,
 * without touching disabled rows. Numeric axes: shrink steps via a global multiplier
 * (binary search), then water-fill by trimming enum level counts, then numeric > 2.
 */
export function adaptAxisTableToFactorialCap(
  table: Record<GridAxisId, GridAxisSweepRow>,
  enabledIds: readonly GridAxisId[],
  _base: SimConfig,
  rawCap: number,
): {
  table: Record<GridAxisId, GridAxisSweepRow>;
  ok: boolean;
  productBefore: number;
  productAfter: number;
  message?: string;
} {
  const cap = Math.max(1, Math.min(GRID_ABS_MAX_RUNS, Math.floor(rawCap)));
  const next: Record<GridAxisId, GridAxisSweepRow> = { ...table };
  for (const id of enabledIds) {
    next[id] = { ...table[id]! };
  }

  if (enabledIds.length === 0) {
    return { table: next, ok: true, productBefore: 0, productAfter: 0 };
  }

  const defs = enabledIds.map((id) => getGridAxisDefinition(id));
  const beforeLevels = enabledIds.map((id) => axisEffectiveLevels(table, id));
  const productBefore = productAxisLevels(beforeLevels);
  if (productBefore <= cap) {
    return { table: next, ok: true, productBefore, productAfter: productBefore };
  }

  const minProduct = defs.reduce((acc, d) => acc * minAchievableLevelsForAxis(d), 1);
  if (minProduct > cap) {
    return {
      table: next,
      ok: false,
      productBefore,
      productAfter: minProduct,
      message: `Even at minimum resolution per axis (product ${minProduct.toLocaleString(
        "en-US",
      )}), the plan exceeds the max runs cap (${cap.toLocaleString("en-US")}). Disable some axes or raise the cap.`,
    };
  }

  const numericOrig = enabledIds
    .map((id, i) => ({ id, def: defs[i]!, orig: beforeLevels[i]! }))
    .filter((x) => x.def.sweep.kind !== "enum");
  const enumMeta = enabledIds
    .map((id, i) => ({ id, def: defs[i]!, fullLen: beforeLevels[i]! }))
    .filter((x) => x.def.sweep.kind === "enum");

  let enumLevels = enumMeta.map((e) => {
    const sw = e.def.sweep;
    return sw.kind === "enum" ? Math.min(sw.values.length, e.fullLen) : e.fullLen;
  });

  const numericStepsAtM = (m: number): number[] =>
    numericOrig.map(({ orig }) =>
      clampGridAxisStepCount(Math.max(2, Math.round(m * Math.max(2, orig)))),
    );

  const productNumericEnum = (numericSteps: readonly number[], enums: readonly number[]) => {
    let p = 1;
    for (const s of numericSteps) p *= Math.max(2, s);
    for (const s of enums) p *= Math.max(1, s);
    return p;
  };

  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 56; iter++) {
    const mid = (lo + hi) / 2;
    const ns = numericStepsAtM(mid);
    if (productNumericEnum(ns, enumLevels) <= cap) lo = mid;
    else hi = mid;
  }
  let numericFinal = numericStepsAtM(lo);
  if (productNumericEnum(numericFinal, enumLevels) > cap) {
    numericFinal = numericStepsAtM(lo - 1e-9);
  }

  while (productNumericEnum(numericFinal, enumLevels) > cap) {
    let reduced = false;
    for (let i = enumLevels.length - 1; i >= 0; i--) {
      const sw = enumMeta[i]!.def.sweep;
      const L = sw.kind === "enum" ? sw.values.length : 1;
      if (enumLevels[i]! > 2) {
        enumLevels[i]!--;
        reduced = true;
        break;
      }
      if (enumLevels[i]! > 1 && L > 1) {
        enumLevels[i]!--;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;

    const ni = numericFinal.findIndex((s) => s > 2);
    if (ni >= 0) {
      numericFinal = numericFinal.map((s, j) => (j === ni ? s - 1 : s));
      numericFinal[ni] = clampGridAxisStepCount(numericFinal[ni]!);
      reduced = true;
    }
    if (!reduced) break;
  }

  const productAfter = productNumericEnum(numericFinal, enumLevels);
  if (productAfter > cap) {
    return {
      table: next,
      ok: false,
      productBefore,
      productAfter,
      message: `Could not reduce the factorial under ${cap.toLocaleString(
        "en-US",
      )} runs with the current enabled axes.`,
    };
  }

  let numIdx = 0;
  for (let i = 0; i < enabledIds.length; i++) {
    const id = enabledIds[i]!;
    const def = defs[i]!;
    if (def.sweep.kind === "enum") {
      const ei = enumMeta.findIndex((m) => m.id === id);
      next[id] = { ...next[id]!, steps: enumLevels[ei]! };
    } else {
      next[id] = { ...next[id]!, steps: numericFinal[numIdx]! };
      numIdx++;
    }
  }

  return { table: next, ok: true, productBefore, productAfter };
}

function sumOatEnabledLevels(
  table: Record<GridAxisId, GridAxisSweepRow>,
  enabledIds: readonly GridAxisId[],
): number {
  let s = 0;
  for (const id of enabledIds) {
    s += axisEffectiveLevels(table, id);
  }
  return s;
}

/**
 * Shrink per-axis level counts so the **sum** of enabled axis levels (OAT batch size) fits under `cap`.
 */
export function adaptAxisTableToOatSumCap(
  table: Record<GridAxisId, GridAxisSweepRow>,
  enabledIds: readonly GridAxisId[],
  rawCap: number,
): {
  table: Record<GridAxisId, GridAxisSweepRow>;
  ok: boolean;
  sumBefore: number;
  sumAfter: number;
  message?: string;
} {
  const cap = Math.max(1, Math.min(GRID_ABS_MAX_RUNS, Math.floor(rawCap)));
  const next: Record<GridAxisId, GridAxisSweepRow> = { ...table };
  for (const id of enabledIds) {
    next[id] = { ...table[id]! };
  }

  if (enabledIds.length === 0) {
    return { table: next, ok: true, sumBefore: 0, sumAfter: 0 };
  }

  const sumBefore = sumOatEnabledLevels(next, enabledIds);
  if (sumBefore <= cap) {
    return { table: next, ok: true, sumBefore, sumAfter: sumBefore };
  }

  const minSum = enabledIds.reduce(
    (acc, id) => acc + minAchievableLevelsForAxis(getGridAxisDefinition(id)),
    0,
  );
  if (minSum > cap) {
    return {
      table: next,
      ok: false,
      sumBefore,
      sumAfter: minSum,
      message: `Even at minimum resolution per axis (OAT sum ${minSum.toLocaleString(
        "en-US",
      )}), the plan exceeds the max runs cap (${cap.toLocaleString("en-US")}). Disable some axes or raise the cap.`,
    };
  }

  let guard = 0;
  while (sumOatEnabledLevels(next, enabledIds) > cap && guard++ < 500_000) {
    let pick: GridAxisId | null = null;
    let pickLv = -1;
    for (const id of enabledIds) {
      const def = getGridAxisDefinition(id);
      const lv = axisEffectiveLevels(next, id);
      const minLv = minAchievableLevelsForAxis(def);
      if (lv > minLv && lv > pickLv) {
        pickLv = lv;
        pick = id;
      }
    }
    if (!pick) break;
    const row = next[pick]!;
    const def = getGridAxisDefinition(pick);
    if (def.sweep.kind === "enum") {
      next[pick] = { ...row, steps: Math.max(1, row.steps - 1) };
    } else {
      next[pick] = { ...row, steps: clampGridAxisStepCount(Math.max(2, row.steps - 1)) };
    }
  }

  const sumAfter = sumOatEnabledLevels(next, enabledIds);
  if (sumAfter > cap) {
    return {
      table: next,
      ok: false,
      sumBefore,
      sumAfter,
      message: `Could not reduce the OAT sum under ${cap.toLocaleString("en-US")} runs.`,
    };
  }

  return { table: next, ok: true, sumBefore, sumAfter };
}

/**
 * Sample values for one grid axis using explicit numeric bounds (sidebar overrides).
 * Enum axes ignore bounds; `steps` is the number of levels (subsampled when below full enum size).
 */
export function sampleAxisValuesWithBounds(
  def: GridAxisDefinition,
  steps: number,
  bounds: { min: number; max: number },
): (number | string)[] {
  if (def.sweep.kind === "enum") {
    const all = def.sweep.values;
    const L = all.length;
    const k = Math.min(L, Math.max(1, Math.round(steps)));
    if (k >= L) return [...all];
    return subsampleEnumValues(all, k);
  }
  const st = clampGridAxisStepCount(steps);
  const lo = bounds.min;
  const hi = bounds.max;
  if (def.sweep.kind === "linear_int") return linspaceInt(lo, hi, st);
  return linspace(lo, hi, st);
}

export type GridAxisAssignment = { id: GridAxisId; value: number | string };

/**
 * Apply any number of axis values to the baseline config and batch manifest slice.
 */
export function applyMultipleAxesToCell(
  base: SimConfig,
  manifest0: CellManifest,
  assignments: readonly GridAxisAssignment[],
): { config: SimConfig; manifest: CellManifest } {
  let cfg: SimConfig = { ...base, policy: { ...base.policy }, agentCounts: { ...base.agentCounts } };
  let manifest = { ...manifest0 };
  for (const { id, value } of assignments) {
    if (id === "ui.policyMode") {
      manifest = { ...manifest, policyMode: value as "heuristic" | "qre" };
      continue;
    }
    if (id === "manifest.qreTemperature") {
      manifest = { ...manifest, qreTemperature: Number(value) };
      continue;
    }
    cfg = applyGridAxisValue(cfg, id, value);
  }
  return { config: cfg, manifest };
}

export function formatAxisCellValue(v: number | string): string {
  if (typeof v === "string") return v.length > 12 ? `${v.slice(0, 11)}…` : v;
  if (Number.isInteger(v) && Math.abs(v) >= 10) return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(3);
}

const META = {
  seed: {
    label: "Random seed",
    short: "seed",
    category: "Run clock",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) =>
      linspaceInt(Math.max(0, b.seed - steps * 997), b.seed + steps * 997, steps),
  },
  ticks: {
    label: "Ticks",
    short: "ticks",
    category: "Run clock",
    sweep: { kind: "linear_int", min: 1, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const lo = Math.max(5, Math.floor(b.ticks * 0.35));
      const hi = Math.max(lo + steps, Math.ceil(b.ticks * 1.65));
      return linspaceInt(lo, hi, steps);
    },
  },
  "agentCounts.bigco": {
    label: "bigco count",
    short: "bigco",
    category: "Population counts",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const c = b.agentCounts.bigco;
      return linspaceInt(Math.max(0, Math.floor(c * 0.35)), Math.max(c + 2, Math.ceil(c * 1.65)), steps);
    },
  },
  "agentCounts.academic": {
    label: "academic count",
    short: "acad",
    category: "Population counts",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const c = b.agentCounts.academic;
      return linspaceInt(Math.max(0, Math.floor(c * 0.35)), Math.max(c + 2, Math.ceil(c * 1.65)), steps);
    },
  },
  "agentCounts.smb": {
    label: "smb count",
    short: "smb",
    category: "Population counts",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const c = b.agentCounts.smb;
      return linspaceInt(Math.max(0, Math.floor(c * 0.35)), Math.max(c + 2, Math.ceil(c * 1.65)), steps);
    },
  },
  "agentCounts.solo": {
    label: "solo count",
    short: "solo",
    category: "Population counts",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const c = b.agentCounts.solo;
      return linspaceInt(Math.max(0, Math.floor(c * 0.35)), Math.max(c + 2, Math.ceil(c * 1.65)), steps);
    },
  },
  "policy.patentRegime": {
    label: "Patent regime",
    short: "reg",
    category: "IP policy",
    sweep: { kind: "enum", values: ["none", "weak", "strong"] as const satisfies readonly PatentRegime[] },
  },
  "policy.patentDurationTicks": {
    label: "Patent duration (ticks)",
    short: "patY",
    category: "IP policy",
    sweep: { kind: "linear_int", min: 1, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const p = b.policy.patentDurationTicks;
      return linspaceInt(Math.max(1, p - 25), p + 35, steps);
    },
  },
  "policy.enforcementIntensity": {
    label: "Enforcement intensity",
    short: "enf",
    category: "IP policy",
    sweep: { kind: "linear", min: 0, max: 1 },
  },
  "policy.openScienceSubsidy": {
    label: "Open-science subsidy",
    short: "sub",
    category: "IP policy",
    sweep: { kind: "linear", min: 0, max: 1 },
  },
  "policy.dataSharingMandateStrength": {
    label: "Data-sharing mandate",
    short: "data",
    category: "IP policy",
    sweep: { kind: "linear", min: 0, max: 1 },
  },
  "policy.regulatoryAmbition": {
    label: "Regulatory ambition",
    short: "amb",
    category: "IP policy",
    sweep: { kind: "linear", min: 0, max: 1 },
  },
  "policy.litigationCostMultiplier": {
    label: "Litigation cost multiplier",
    short: "lit",
    category: "IP policy",
    sweep: { kind: "linear", min: 0.5, max: 2 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.policy.litigationCostMultiplier;
      return linspace(Math.max(0.25, x * 0.5), Math.min(3, x * 1.5), steps);
    },
  },
  "regulatory.enabled": {
    label: "Regulatory pressure enabled",
    short: "rOn",
    category: "Regulation",
    sweep: { kind: "enum", values: ["off", "on"] as const },
  },
  "regulatory.ruleMode": {
    label: "Regulatory rule dynamics",
    short: "rule",
    category: "Regulation",
    sweep: { kind: "enum", values: ["fixed", "dynamic"] as const },
  },
  "regulatory.bribe.enabled": {
    label: "Bribe action enabled",
    short: "brb",
    category: "Regulation",
    sweep: { kind: "enum", values: ["off", "on"] as const },
  },
  "spawn.enabled": {
    label: "Spawn / entry enabled",
    short: "spE",
    category: "Population growth",
    sweep: { kind: "enum", values: ["off", "on"] as const },
  },
  "spawn.maxAgents": {
    label: "Max agents (spawn cap)",
    short: "cap",
    category: "Population growth",
    sweep: { kind: "linear_int", min: 2, max: 2 },
    customSample: (steps: number, b: SimConfig) => {
      const c = Math.max(totalAgents(b.agentCounts), b.spawn.maxAgents);
      return linspaceInt(Math.max(2, c - 40), c + 80, steps);
    },
  },
  investRndBaseCost: {
    label: "R&D base cost",
    short: "rnd0",
    category: "Innovation & decay",
    sweep: { kind: "linear", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.investRndBaseCost;
      return linspace(Math.max(1, x * 0.45), x * 1.55, steps);
    },
  },
  investRndCostRandomSpan: {
    label: "R&D cost random span",
    short: "rndσ",
    category: "Innovation & decay",
    sweep: { kind: "linear", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.investRndCostRandomSpan;
      return linspace(0, Math.max(x * 1.8, x + 2), steps);
    },
  },
  investRndCostPerKnowledge: {
    label: "R&D cost / knowledge",
    short: "rndK",
    category: "Innovation & decay",
    sweep: { kind: "linear", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.investRndCostPerKnowledge;
      return linspace(0, Math.max(0.02, x * 2.5 + 0.02), steps);
    },
  },
  innovationDelayTicks: {
    label: "Innovation delay (ticks)",
    short: "delay",
    category: "Innovation & decay",
    sweep: { kind: "linear_int", min: 0, max: 1 },
    customSample: (steps: number, b: SimConfig) => {
      const d = b.innovationDelayTicks;
      return linspaceInt(0, Math.max(d + 12, 18), steps);
    },
  },
  wealthDepreciationRate: {
    label: "Wealth depreciation / tick",
    short: "δw",
    category: "Innovation & decay",
    sweep: { kind: "linear", min: 0, max: 0.2 },
  },
  knowledgeDepreciationRate: {
    label: "Knowledge depreciation / tick",
    short: "δk",
    category: "Innovation & decay",
    sweep: { kind: "linear", min: 0, max: 0.2 },
  },
  capabilityBeta: {
    label: "Capability β (market kernel)",
    short: "βcap",
    category: "Market / spillovers",
    sweep: { kind: "linear", min: 0.2, max: 0.95 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.capabilityBeta;
      return linspace(Math.max(0.15, x * 0.85), Math.min(0.98, x * 1.12), steps);
    },
  },
  spilloverAlpha: {
    label: "Spillover α",
    short: "αsp",
    category: "Market / spillovers",
    sweep: { kind: "linear", min: 0.05, max: 0.6 },
    customSample: (steps: number, b: SimConfig) => {
      const x = b.spilloverAlpha;
      return linspace(Math.max(0.02, x * 0.75), Math.min(0.75, x * 1.25), steps);
    },
  },
  "ui.policyMode": {
    label: "Policy mode (batch)",
    short: "pol",
    category: "Decision rule",
    sweep: { kind: "enum", values: ["heuristic", "qre"] as const },
  },
  "manifest.qreTemperature": {
    label: "QRE temperature",
    short: "τ",
    category: "Decision rule",
    sweep: { kind: "linear", min: 0.1, max: 2 },
  },
} as const;

export type GridAxisId = keyof typeof META;

/** Per-axis tooltip copy for the batch parameter grid (aligned with Run sidebar labels). */
const GRID_AXIS_DESCRIPTIONS: Record<GridAxisId, string> = {
  seed:
    "Master seed for pseudo-random draws (world setup and per-tick streams). Same seed reproduces a run at fixed settings.",
  ticks:
    "Number of discrete time steps per simulation. Longer runs cost more compute; sweeps vary horizon around your sidebar value.",
  "agentCounts.bigco":
    "Count of big-company agents. Sweeps rescale this cohort type while other counts follow the table unless you enable those rows too.",
  "agentCounts.academic":
    "Count of academic agents. Sweeps vary this population slice relative to your baseline Run configuration.",
  "agentCounts.smb": "Count of SMB agents in the synthetic market; larger values increase local competition and collaboration edges.",
  "agentCounts.solo": "Count of solo agents; adjusts the smallest-firm slice of the population mix for the batch.",
  "policy.patentRegime":
    "Exclusive-rights strength tier (none / weak / strong): affects filing costs, patent licensing uplift, and openness-linked bonuses.",
  "policy.patentDurationTicks":
    "Patent lifetime in ticks before expiry—shorter rotates exclusivity faster; longer extends licensing returns.",
  "policy.enforcementIntensity":
    "Scales IP enforcement / dispute-style transfers when overlapping patents exist—higher intensifies deterrence and legal spend.",
  "policy.openScienceSubsidy":
    "Public support lowering the wealth cost of open publication and boosting spillovers into the global knowledge pool.",
  "policy.dataSharingMandateStrength":
    "Regulatory pressure for reproducibility and openness—raises spillover benefits when findings are published openly.",
  "policy.regulatoryAmbition":
    "Baseline strictness target for harm mitigation when the externality/regulation module is active.",
  "policy.litigationCostMultiplier":
    "Scales wealth spent on enforcement-style IP actions when overlapping patents exist—higher makes disputes costlier.",
  "regulatory.enabled":
    "Turns the externality channel on or off: offerings map into social loads, transfers, and mitigation each tick.",
  "regulatory.ruleMode":
    "How regulatory stringency evolves: fixed tracks ambition each tick; dynamic uses a mean-reverting noisy process.",
  "regulatory.bribe.enabled":
    "Allows a costly influence action that may weaken enforcement; detection applies fines—capture risk in reduced form.",
  "spawn.enabled": "Whether endogenous entry/recruitment can add agents during the run.",
  "spawn.maxAgents":
    "Hard ceiling on total agents when spawning is on—prevents unbounded growth and keeps batches tractable.",
  investRndBaseCost:
    "Fixed wealth spent before stochastic and knowledge-linked parts of an R&D attempt—baseline project difficulty.",
  investRndCostRandomSpan:
    "Half-width of uniform noise on R&D cost draws—heterogeneity and unpredictability of research spend.",
  investRndCostPerKnowledge:
    "Extra marginal cost per unit of current knowledge—larger stocks make further advances more expensive.",
  innovationDelayTicks:
    "Integer ticks between committing R&D and receiving knowledge payoffs—pipeline lag in the innovation loop.",
  wealthDepreciationRate: "Multiplicative wealth loss each tick (maintenance/consumption style decay).",
  knowledgeDepreciationRate: "Knowledge stock lost to obsolescence or forgetting each tick.",
  capabilityBeta:
    "Capability weight in the competitive market kernel—how strongly knowledge translates into contestable demand.",
  spilloverAlpha:
    "Spillover absorption into neighbor knowledge stocks via the market adjacency structure.",
  "ui.policyMode":
    "Per-cell decision rule for the batch only: fast heuristic vs softmax QRE sampling (does not enable LLM batches).",
  "manifest.qreTemperature":
    "QRE softmax temperature for batched QRE cells—lower concentrates on best replies; higher adds randomization.",
};

export const GRID_AXIS_DEFINITIONS: GridAxisDefinition[] = (Object.keys(META) as GridAxisId[]).map((id) => ({
  id,
  ...(META[id] as Omit<GridAxisDefinition, "id" | "description">),
  description: GRID_AXIS_DESCRIPTIONS[id],
}));

const AXIS_BY_ID = new Map<string, GridAxisDefinition>(
  GRID_AXIS_DEFINITIONS.map((d) => [d.id, d]),
);

export function getGridAxisDefinition(id: string): GridAxisDefinition {
  const d = AXIS_BY_ID.get(id);
  if (!d) throw new Error(`Unknown grid axis: ${id}`);
  return d;
}

export function isManifestOnlyAxis(id: GridAxisId): boolean {
  return id === "manifest.qreTemperature" || id === "ui.policyMode";
}

export type CellManifest = {
  policyMode: "heuristic" | "qre";
  qreTemperature: number;
};

export function defaultCellManifest(
  sidebarMode: "heuristic" | "qre" | "llm",
  qreTemp: number,
): CellManifest {
  const policyMode = sidebarMode === "qre" ? "qre" : "heuristic";
  return { policyMode, qreTemperature: qreTemp };
}

export function applyAxesToCell(
  base: SimConfig,
  manifest0: CellManifest,
  axisAId: GridAxisId,
  va: number | string,
  axisBId: GridAxisId,
  vb: number | string,
): { config: SimConfig; manifest: CellManifest } {
  return applyMultipleAxesToCell(base, manifest0, [
    { id: axisAId, value: va },
    { id: axisBId, value: vb },
  ]);
}

export function applyGridAxisValue(
  cfg: SimConfig,
  id: GridAxisId,
  value: number | string,
): SimConfig {
  if (id === "ui.policyMode" || id === "manifest.qreTemperature") return cfg;

  const n = typeof value === "number" ? value : Number(value);
  switch (id) {
    case "seed":
      return { ...cfg, seed: Math.max(0, Math.round(n)) };
    case "ticks":
      return { ...cfg, ticks: Math.max(1, Math.round(n)) };
    case "agentCounts.bigco":
      return {
        ...cfg,
        agentCounts: { ...cfg.agentCounts, bigco: Math.max(0, Math.round(n)) },
      };
    case "agentCounts.academic":
      return {
        ...cfg,
        agentCounts: { ...cfg.agentCounts, academic: Math.max(0, Math.round(n)) },
      };
    case "agentCounts.smb":
      return {
        ...cfg,
        agentCounts: { ...cfg.agentCounts, smb: Math.max(0, Math.round(n)) },
      };
    case "agentCounts.solo":
      return {
        ...cfg,
        agentCounts: { ...cfg.agentCounts, solo: Math.max(0, Math.round(n)) },
      };
    case "policy.patentRegime":
      return { ...cfg, policy: { ...cfg.policy, patentRegime: value as PatentRegime } };
    case "policy.patentDurationTicks":
      return {
        ...cfg,
        policy: { ...cfg.policy, patentDurationTicks: Math.max(1, Math.round(n)) },
      };
    case "policy.enforcementIntensity":
      return { ...cfg, policy: { ...cfg.policy, enforcementIntensity: clamp(n, 0, 1) } };
    case "policy.openScienceSubsidy":
      return { ...cfg, policy: { ...cfg.policy, openScienceSubsidy: clamp(n, 0, 1) } };
    case "policy.dataSharingMandateStrength":
      return { ...cfg, policy: { ...cfg.policy, dataSharingMandateStrength: clamp(n, 0, 1) } };
    case "policy.regulatoryAmbition":
      return { ...cfg, policy: { ...cfg.policy, regulatoryAmbition: clamp(n, 0, 1) } };
    case "policy.litigationCostMultiplier":
      return {
        ...cfg,
        policy: { ...cfg.policy, litigationCostMultiplier: Math.max(0.05, n) },
      };
    case "regulatory.enabled":
      return {
        ...cfg,
        regulatory: { ...cfg.regulatory, enabled: value === "on" },
      };
    case "regulatory.ruleMode":
      return {
        ...cfg,
        regulatory: { ...cfg.regulatory, ruleMode: value as "fixed" | "dynamic" },
      };
    case "regulatory.bribe.enabled":
      return {
        ...cfg,
        regulatory: {
          ...cfg.regulatory,
          bribe: { ...cfg.regulatory.bribe, enabled: value === "on" },
        },
      };
    case "spawn.enabled":
      return { ...cfg, spawn: { ...cfg.spawn, enabled: value === "on" } };
    case "spawn.maxAgents":
      return { ...cfg, spawn: { ...cfg.spawn, maxAgents: Math.max(2, Math.round(n)) } };
    case "investRndBaseCost":
      return { ...cfg, investRndBaseCost: Math.max(0, n) };
    case "investRndCostRandomSpan":
      return { ...cfg, investRndCostRandomSpan: Math.max(0, n) };
    case "investRndCostPerKnowledge":
      return { ...cfg, investRndCostPerKnowledge: Math.max(0, n) };
    case "innovationDelayTicks":
      return { ...cfg, innovationDelayTicks: Math.max(0, Math.round(n)) };
    case "wealthDepreciationRate":
      return { ...cfg, wealthDepreciationRate: clamp(n, 0, 1) };
    case "knowledgeDepreciationRate":
      return { ...cfg, knowledgeDepreciationRate: clamp(n, 0, 1) };
    case "capabilityBeta":
      return { ...cfg, capabilityBeta: clamp(n, 0.05, 0.99) };
    case "spilloverAlpha":
      return { ...cfg, spilloverAlpha: clamp(n, 0.01, 0.95) };
    default: {
      const _x: never = id;
      return _x;
    }
  }
}
