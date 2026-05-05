import {
  qrePolicy,
  runSimulationSync,
  type AgentState,
  type SimConfig,
  type SimulationRun,
  type TickRecord,
  type WorldState,
} from "@ip-sim/core";
import { runSimulationHeuristicWasm } from "@/lib/rustHeuristicRun";
import {
  applyMultipleAxesToCell,
  autoSweepPointsPerAxis,
  defaultCellManifest,
  deriveDefaultNumericBounds,
  getGridAxisDefinition,
  mulberry32,
  type GridAxisAssignment,
  type GridAxisId,
} from "@/lib/gridAxes";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import { totalAgents } from "@/lib/populationPresets";

/** Outcome metric matched against a numeric target (lower squared error = fitter). */
export type OptimizationMetricKey =
  | "giniWealth"
  | "meanWealth"
  | "innovationFlow"
  | "innovationFlowPerAgent"
  | "totalWealth"
  | "top10WealthShare"
  | "innovationFlowPerMeanWealth";

function clamp01(u: number): number {
  return Math.min(1 - 1e-9, Math.max(1e-9, u));
}

export function readOptimizationMetric(last: TickRecord, key: OptimizationMetricKey): number {
  const m = last.metrics;
  switch (key) {
    case "giniWealth":
      return m.giniWealth;
    case "meanWealth":
      return meanWealthAtTick(last);
    case "innovationFlow":
      return innovationFlowAtTick(last);
    case "innovationFlowPerAgent":
      return innovationFlowPerAgentAtTick(last);
    case "totalWealth":
      return m.totalWealth;
    case "top10WealthShare":
      return m.top10WealthShare;
    case "innovationFlowPerMeanWealth": {
      const mw = meanWealthAtTick(last);
      const flow = innovationFlowAtTick(last);
      if (!Number.isFinite(mw) || mw === 0) return Number.NaN;
      return flow / mw;
    }
    default:
      return Number.NaN;
  }
}

export const OPTIMIZATION_METRIC_LABELS: Record<OptimizationMetricKey, string> = {
  giniWealth: "Gini (wealth)",
  meanWealth: "Mean wealth / agent",
  innovationFlow: "Innovation flow (aggregate)",
  innovationFlowPerAgent: "Innovation flow / agent",
  totalWealth: "Total wealth",
  top10WealthShare: "Top-10 wealth share",
  innovationFlowPerMeanWealth: "Innovation flow ÷ mean wealth",
};

/**
 * Map normalized genes [0,1]^d to grid assignments using current default numeric bounds
 * (same span as the batch sweep table for the baseline config).
 */
export function genesToAssignments(
  genes: readonly number[],
  axisIds: readonly GridAxisId[],
  base: SimConfig,
): GridAxisAssignment[] {
  const auto = autoSweepPointsPerAxis(base);
  const out: GridAxisAssignment[] = [];
  for (let i = 0; i < axisIds.length; i++) {
    const id = axisIds[i]!;
    const def = getGridAxisDefinition(id);
    const u = clamp01(typeof genes[i] === "number" ? genes[i]! : 0.5);
    if (def.sweep.kind === "enum") {
      const vals = def.sweep.values;
      const idx = Math.min(vals.length - 1, Math.floor(u * vals.length));
      out.push({ id, value: vals[idx]! });
      continue;
    }
    const { min, max } = deriveDefaultNumericBounds(def, base, auto);
    if (def.sweep.kind === "linear_int") {
      const v = Math.round(min + u * (max - min));
      const clamped = Math.min(Math.max(v, Math.ceil(Math.min(min, max))), Math.floor(Math.max(min, max)));
      out.push({ id, value: clamped });
    } else {
      out.push({ id, value: min + u * (max - min) });
    }
  }
  return out;
}

/** `target`: minimize (metric − target)². `maximize`: maximize terminal metric (same GA minimizes transformed fitness). */
export type OptimizationObjective = "target" | "maximize";
export type OptimizationPolicyMode = "heuristic" | "qre";

/** One completed simulation evaluation inside `runEvolutionarySearch` (for UI tables / replay). */
export type EvolutionaryEvaluationPayload = {
  /** 0-based generation index */
  generation: number;
  /** 1-based cumulative evaluation count for this search */
  evaluationNumber: number;
  mse: number;
  metricValue: number | null;
  assignments: GridAxisAssignment[];
  run: SimulationRun & { finalWorld?: WorldState };
  isNewBest: boolean;
};

/** Fires immediately before each simulation starts (sequential queue in this implementation). */
export type EvolutionaryEvaluationBeginPayload = {
  generation: number;
  /** Matches the evaluationNumber that will appear in `EvolutionaryEvaluationPayload` when this run completes */
  evaluationNumber: number;
  assignments: GridAxisAssignment[];
};

export type EvolutionarySearchParams = {
  baseConfig: SimConfig;
  mode: "heuristic" | "qre" | "llm";
  policyMode?: OptimizationPolicyMode;
  qreTemp: number;
  axisIds: readonly GridAxisId[];
  metric: OptimizationMetricKey;
  /** Used when `objective` is `"target"`. */
  target: number;
  objective: OptimizationObjective;
  /** Like grid batch: skip evals whose cohort Σ counts exceeds this; also clamps `spawn.maxAgents`. */
  maxAgentsCap?: number | null;
  populationSize: number;
  generations: number;
  mutationRate: number;
  /** When set (length must match `axisIds`), seeds the population from this gene vector and continues search from there. */
  resumeFromBestGenes?: readonly number[] | null;
  /** Added to emitted evaluation indices (for UI continuity across continued runs). */
  evaluationNumberOffset?: number;
  /** Added to emitted generation indices (0-based; for UI continuity). */
  generationDisplayOffset?: number;
  /** Called between evaluations so the UI stays responsive. */
  yieldToUi?: () => Promise<void>;
  shouldCancel?: () => boolean;
  /** Fires after every simulation evaluation with full run + metric (for batch-style tables). */
  onEvaluation?: (payload: EvolutionaryEvaluationPayload) => void;
  /** Fires before each simulation awaits (one active run at a time). */
  onEvaluationBegin?: (payload: EvolutionaryEvaluationBeginPayload) => void;
  onGeneration?: (payload: {
    generation: number;
    bestMse: number;
    bestGenes: number[];
    evaluations: number;
  }) => void;
};

export type EvolutionarySearchResult = {
  bestGenes: number[];
  bestMse: number;
  bestAssignments: GridAxisAssignment[];
  bestRun: SimulationRun & { finalWorld?: WorldState };
  evaluations: number;
  generationsCompleted: number;
  cancelled: boolean;
};

function randomGenes(n: number, rng: () => number): number[] {
  return Array.from({ length: n }, () => rng());
}

function tournamentPick(
  scored: { genes: number[]; mse: number }[],
  rng: () => number,
  k: number,
): number[] {
  let best = scored[Math.floor(rng() * scored.length)]!;
  for (let i = 1; i < k; i++) {
    const c = scored[Math.floor(rng() * scored.length)]!;
    if (c.mse < best.mse) best = c;
  }
  return best.genes;
}

function crossover(a: number[], b: number[], rng: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push(rng() < 0.5 ? a[i]! : b[i]!);
  }
  return out;
}

function mutate(genes: number[], rate: number, rng: () => number): number[] {
  const sigma = 0.18;
  return genes.map((g) => {
    if (rng() >= rate) return g;
    const z = (rng() + rng() + rng() + rng() - 2) / 2;
    return clamp01(g + z * sigma);
  });
}

/** Build initial population around a prior best (normalized gene vector). */
function seedPopulationFromResume(
  best: readonly number[],
  populationSize: number,
  mutationRate: number,
  rng: () => number,
): number[][] {
  const n = best.length;
  const pop: number[][] = [[...best]];
  while (pop.length < populationSize) {
    if (rng() < 0.28) pop.push(randomGenes(n, rng));
    else pop.push(mutate([...best], mutationRate, rng));
  }
  return pop;
}

async function evaluateFitness(
  genes: number[],
  axisIds: readonly GridAxisId[],
  base: SimConfig,
  policyMode: OptimizationPolicyMode,
  qreTemp: number,
  metric: OptimizationMetricKey,
  target: number,
  objective: OptimizationObjective,
  maxAgentsCap: number | null | undefined,
): Promise<{ mse: number; run: SimulationRun & { finalWorld?: WorldState } }> {
  const assignments = genesToAssignments(genes, axisIds, base);
  /** Baseline manifest follows optimize policy; axis overrides (e.g. `ui.policyMode`) can still patch it. */
  const manifest0 = defaultCellManifest(policyMode, qreTemp);
  let { config: cfg, manifest } = applyMultipleAxesToCell(base, manifest0, assignments);

  if (maxAgentsCap != null) {
    if (totalAgents(cfg.agentCounts) > maxAgentsCap) {
      return {
        mse: Number.POSITIVE_INFINITY,
        run: {
          manifest: { ...manifest, seed: cfg.seed, config: cfg } as SimulationRun["manifest"],
          history: [],
        } as SimulationRun & { finalWorld?: WorldState },
      };
    }
    cfg = {
      ...cfg,
      spawn: { ...cfg.spawn, maxAgents: Math.min(cfg.spawn.maxAgents, maxAgentsCap) },
    };
  }

  let run: SimulationRun & { finalWorld?: WorldState };
  if (manifest.policyMode === "qre") {
    run = runSimulationSync({
      config: cfg,
      manifest: {
        policyMode: "qre",
        qreTemperature: manifest.qreTemperature,
      },
      decide: (world: WorldState, agent: AgentState) =>
        qrePolicy(agent, world, {
          temperature: manifest.qreTemperature,
          seedSalt: cfg.seed,
        }),
    }) as SimulationRun & { finalWorld?: WorldState };
  } else {
    run = await runSimulationHeuristicWasm(cfg);
  }

  const last = run.history[run.history.length - 1];
  if (!last) return { mse: Number.POSITIVE_INFINITY, run };
  const val = readOptimizationMetric(last, metric);
  if (!Number.isFinite(val)) return { mse: Number.POSITIVE_INFINITY, run };
  if (objective === "maximize") {
    return { mse: -val, run };
  }
  const err = val - target;
  return { mse: err * err, run };
}

/**
 * Simple genetic algorithm over normalized parameter vectors (genes).
 * With `objective: "target"`, minimizes squared error to a numeric target.
 * With `objective: "maximize"`, maximizes the terminal metric (internal fitness = −metric).
 */
export async function runEvolutionarySearch(params: EvolutionarySearchParams): Promise<EvolutionarySearchResult> {
  const {
    baseConfig,
    mode,
    policyMode = mode === "qre" ? "qre" : "heuristic",
    qreTemp,
    axisIds,
    metric,
    target,
    objective,
    maxAgentsCap,
    populationSize,
    generations,
    mutationRate,
    yieldToUi,
    shouldCancel,
    onEvaluation,
    onEvaluationBegin,
    onGeneration,
    resumeFromBestGenes,
    evaluationNumberOffset = 0,
    generationDisplayOffset = 0,
  } = params;
  if (mode === "llm") {
    throw new Error("Optimization does not support LLM policy mode.");
  }


  const n = axisIds.length;
  const resume =
    resumeFromBestGenes != null &&
    resumeFromBestGenes.length === n &&
    resumeFromBestGenes.length > 0;
  const rngSeed =
    (baseConfig.seed ^
      0xcafe_babe ^
      axisIds.length * 997 ^
      (resume ? 0x51ce_a11e : 0)) >>>
    0;

  const rng = mulberry32(rngSeed);

  let population: number[][];
  let bestEver: {
    genes: number[];
    mse: number;
    assignments: GridAxisAssignment[];
    run: (SimulationRun & { finalWorld?: WorldState }) | null;
  };

  if (resume) {
    const seedGenes = [...resumeFromBestGenes];
    population = seedPopulationFromResume(seedGenes, populationSize, mutationRate, rng);
    bestEver = {
      genes: seedGenes,
      mse: Number.POSITIVE_INFINITY,
      assignments: genesToAssignments(seedGenes, axisIds, baseConfig),
      run: null,
    };
  } else {
    population = Array.from({ length: populationSize }, () => randomGenes(n, rng));
    bestEver = {
      genes: randomGenes(n, rng),
      mse: Number.POSITIVE_INFINITY,
      assignments: [] as GridAxisAssignment[],
      run: null,
    };
  }

  let evaluations = 0;
  let cancelled = false;
  let generationsCompleted = 0;

  const evalPop = async (pop: number[][], generation: number): Promise<{ genes: number[]; mse: number }[]> => {
    const scored: { genes: number[]; mse: number }[] = [];
    for (const genes of pop) {
      if (shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const assignments = genesToAssignments(genes, axisIds, baseConfig);
      onEvaluationBegin?.({
        generation: generation + generationDisplayOffset,
        evaluationNumber: evaluationNumberOffset + evaluations + 1,
        assignments,
      });
      const { mse, run } = await evaluateFitness(
        genes,
        axisIds,
        baseConfig,
        policyMode,
        qreTemp,
        metric,
        target,
        objective,
        maxAgentsCap,
      );
      evaluations++;
      const isNewBest = mse < bestEver.mse;
      if (isNewBest) {
        bestEver = {
          genes: [...genes],
          mse,
          assignments,
          run,
        };
      }
      const history = Array.isArray(run.history) ? run.history : [];
      const last = history.length > 0 ? history[history.length - 1] : undefined;
      let metricValue: number | null = null;
      if (last) {
        const v = readOptimizationMetric(last, metric);
        metricValue = Number.isFinite(v) ? v : null;
      }
      if (history.length > 0) {
        onEvaluation?.({
          generation: generation + generationDisplayOffset,
          evaluationNumber: evaluationNumberOffset + evaluations,
          mse,
          metricValue,
          assignments,
          run,
          isNewBest,
        });
      }
      scored.push({ genes, mse });
      if (yieldToUi) await yieldToUi();
    }
    return scored;
  };

  for (let gen = 0; gen < generations; gen++) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }

    const scored = await evalPop(population, gen);
    if (cancelled) break;

    scored.sort((a, b) => a.mse - b.mse);
    generationsCompleted = gen + 1;

    onGeneration?.({
      generation: gen + generationDisplayOffset,
      bestMse: scored[0]!.mse,
      bestGenes: [...scored[0]!.genes],
      evaluations: evaluationNumberOffset + evaluations,
    });

    const elite = scored.slice(0, 2).map((s) => [...s.genes]);
    const next: number[][] = [...elite];

    while (next.length < populationSize) {
      const p1 = tournamentPick(scored, rng, 3);
      const p2 = tournamentPick(scored, rng, 3);
      let child = crossover(p1, p2, rng);
      child = mutate(child, mutationRate, rng);
      next.push(child);
    }
    population = next.slice(0, populationSize);
  }

  if (!bestEver.run) {
    const fbAssignments = genesToAssignments(bestEver.genes, axisIds, baseConfig);
    const genIdx = generationsCompleted > 0 ? generationsCompleted - 1 : 0;
    onEvaluationBegin?.({
      generation: genIdx + generationDisplayOffset,
      evaluationNumber: evaluationNumberOffset + evaluations + 1,
      assignments: fbAssignments,
    });
    const fallback = await evaluateFitness(
      bestEver.genes,
      axisIds,
      baseConfig,
      policyMode,
      qreTemp,
      metric,
      target,
      objective,
      maxAgentsCap,
    );
    evaluations++;
    bestEver.run = fallback.run;
    bestEver.mse = fallback.mse;
    bestEver.assignments = fbAssignments;
    const fallbackHistory = Array.isArray(fallback.run.history) ? fallback.run.history : [];
    const lastFb = fallbackHistory.length > 0 ? fallbackHistory[fallbackHistory.length - 1] : undefined;
    let metricValueFb: number | null = null;
    if (lastFb) {
      const v = readOptimizationMetric(lastFb, metric);
      metricValueFb = Number.isFinite(v) ? v : null;
    }
    if (fallbackHistory.length > 0) {
      onEvaluation?.({
        generation: genIdx + generationDisplayOffset,
        evaluationNumber: evaluationNumberOffset + evaluations,
        mse: fallback.mse,
        metricValue: metricValueFb,
        assignments: fbAssignments,
        run: fallback.run,
        isNewBest: true,
      });
    }
  }

  return {
    bestGenes: bestEver.genes,
    bestMse: bestEver.mse,
    bestAssignments: bestEver.assignments,
    bestRun: bestEver.run!,
    evaluations,
    generationsCompleted,
    cancelled,
  };
}
