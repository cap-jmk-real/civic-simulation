import type { LabJobOptimizationProgress } from "@/lib/labJobStore";
import type { OptimizationMetricKey, OptimizationObjective } from "@/lib/evolutionaryOptimize";
import type { LabSessionHydrationSummary } from "@/lib/simQueue/activeRunHydration";

export type OptimizationProgressSnapshot = {
  evaluationIndex: number;
  generation: number;
  trialCount: number;
};

export type HydratedOptimizationLiveProgress = {
  evaluations: number;
  planned: number | null;
  generation: number | null;
  elapsedMs: number;
  throughputPerSec: number | null;
};

export type PersistedOptimizationTrial = {
  id: string;
  generation: number;
  evaluation_index: number;
  metric_value: number | null;
  mse: number;
  elapsed_ms: number | null;
  is_new_best?: number;
  has_run_payload?: boolean;
  created_at: string;
};

export type HydratedRecentFinishedOptimizationTrial = {
  id: string;
  generation: number;
  evaluationNumber: number;
  metricValue: number | null;
  mse: number;
  durationMs: number | null;
  finishedAt: string;
};

export type OptimizationOverviewRow = {
  id: string;
  generation: number | null;
  evaluationNumber: number | null;
  metricValue: number | null;
  mse: number | null;
  rmse: number | null;
  durationMs: number | null;
  finishedAt: string | null;
  source: "local" | "persisted";
  status: "finished" | "running" | "unknown";
  isBest: boolean;
  hasPreviewRun: boolean;
};

export type OptimizationOverviewSortKey =
  | "evaluation"
  | "generation"
  | "metric"
  | "rmse"
  | "duration"
  | "finishedAt";
export type OptimizationOverviewSortDirection = "asc" | "desc";
export type OptimizationOverviewSortState = {
  key: OptimizationOverviewSortKey;
  direction: OptimizationOverviewSortDirection;
};

export type OptimizationWaitingDiagnostics = {
  phase: "evaluating" | "waiting_to_persist" | "idle";
  lastPersistedTrialAt: string | null;
  sinceLastTrialWriteMs: number | null;
  staleThresholdMs: number;
  showLongWaitNote: boolean;
  message: string;
};

const OPTIMIZATION_METRIC_KEYS: ReadonlySet<OptimizationMetricKey> = new Set([
  "giniWealth",
  "meanWealth",
  "innovationFlow",
  "innovationFlowPerAgent",
  "totalWealth",
  "top10WealthShare",
  "innovationFlowPerMeanWealth",
]);

function readOptimizationMetricKey(value: unknown): OptimizationMetricKey | null {
  if (typeof value !== "string") return null;
  return OPTIMIZATION_METRIC_KEYS.has(value as OptimizationMetricKey) ? (value as OptimizationMetricKey) : null;
}

function readOptimizationObjective(value: unknown): OptimizationObjective | null {
  if (value === "target" || value === "maximize") return value;
  return null;
}

function readOptimizationPolicyMode(value: unknown): "heuristic" | "qre" | null {
  if (value === "heuristic" || value === "qre") return value;
  return null;
}

export type SessionOptimizationSettings = {
  metric: OptimizationMetricKey | null;
  objective: OptimizationObjective | null;
  target: number | null;
  policyMode: "heuristic" | "qre" | null;
  qreTemp: number | null;
};

export function deriveSessionOptimizationSettings(meta: unknown): SessionOptimizationSettings {
  if (meta == null || typeof meta !== "object") {
    return { metric: null, objective: null, target: null, policyMode: null, qreTemp: null };
  }
  const m = meta as Record<string, unknown>;
  const target = typeof m.target === "number" && Number.isFinite(m.target) ? m.target : null;
  const qreTemp = typeof m.qreTemp === "number" && Number.isFinite(m.qreTemp) ? m.qreTemp : null;
  return {
    metric: readOptimizationMetricKey(m.metric),
    objective: readOptimizationObjective(m.objective),
    target,
    policyMode: readOptimizationPolicyMode(m.policyMode),
    qreTemp,
  };
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toSortNumber(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function compareNullableNumber(a: number | null, b: number | null, direction: OptimizationOverviewSortDirection): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareNullableTimestamp(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: OptimizationOverviewSortDirection,
): number {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  const va = Number.isFinite(ta) ? ta : null;
  const vb = Number.isFinite(tb) ? tb : null;
  return compareNullableNumber(va, vb, direction);
}

function plannedFromMeta(meta: unknown): number | null {
  if (meta == null || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const pop = asFiniteNumber(m.populationSize);
  const gens = asFiniteNumber(m.generations);
  if (pop == null || gens == null) return null;
  const planned = Math.max(0, Math.floor(pop) * Math.floor(gens));
  return planned > 0 ? planned : null;
}

export function deriveHydratedOptimizationLiveProgress(input: {
  session: LabSessionHydrationSummary;
  snapshot: OptimizationProgressSnapshot | null;
  localProgress: LabJobOptimizationProgress | null;
  nowMs: number;
}): HydratedOptimizationLiveProgress {
  const evaluations = Math.max(
    0,
    input.snapshot?.evaluationIndex ?? 0,
    input.snapshot?.trialCount ?? 0,
    input.session.trialCount,
    input.localProgress?.evaluations ?? 0,
  );
  const planned =
    plannedFromMeta(input.session.meta) ??
    (input.localProgress?.planned != null && input.localProgress.planned > 0
      ? input.localProgress.planned
      : null);
  const generationCandidates = [input.snapshot?.generation, input.localProgress?.generation].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  const generation = generationCandidates.length > 0 ? Math.max(...generationCandidates) : null;

  const startedAt = Date.parse(input.session.createdAt ?? input.session.updatedAt);
  const elapsedMs = Math.max(0, input.nowMs - (Number.isFinite(startedAt) ? startedAt : input.nowMs));
  const throughputPerSec =
    evaluations > 0 && elapsedMs > 0 ? (evaluations / elapsedMs) * 1000 : null;

  return { evaluations, planned, generation, elapsedMs, throughputPerSec };
}

export function deriveHydratedRecentFinishedOptimizationTrials(input: {
  trials: PersistedOptimizationTrial[];
  snapshot: OptimizationProgressSnapshot | null;
  cap?: number;
}): HydratedRecentFinishedOptimizationTrial[] {
  const cap = Math.max(1, Math.floor(input.cap ?? 10));
  const maxKnownEvaluation =
    input.snapshot != null
      ? Math.max(
          0,
          input.snapshot.evaluationIndex,
          input.snapshot.trialCount,
        )
      : Number.POSITIVE_INFINITY;

  return input.trials
    .filter((t) => Number.isFinite(t.evaluation_index) && t.evaluation_index <= maxKnownEvaluation)
    .sort((a, b) => {
      if (b.evaluation_index !== a.evaluation_index) return b.evaluation_index - a.evaluation_index;
      const ta = Date.parse(a.created_at);
      const tb = Date.parse(b.created_at);
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    })
    .slice(0, cap)
    .map((t) => ({
      id: t.id,
      generation: t.generation,
      evaluationNumber: t.evaluation_index,
      metricValue: t.metric_value,
      mse: t.mse,
      durationMs: toSortNumber(t.elapsed_ms),
      finishedAt: t.created_at,
    }));
}

export function deriveHydratedOptimizationOverviewRows(input: {
  trials: PersistedOptimizationTrial[];
  snapshot: OptimizationProgressSnapshot | null;
  cap?: number;
}): OptimizationOverviewRow[] {
  const cap = Math.max(1, Math.floor(input.cap ?? 400));
  const maxKnownEvaluation =
    input.snapshot != null
      ? Math.max(
          0,
          input.snapshot.evaluationIndex,
          input.snapshot.trialCount,
        )
      : Number.POSITIVE_INFINITY;

  return input.trials
    .filter((t) => Number.isFinite(t.evaluation_index) && t.evaluation_index <= maxKnownEvaluation)
    .sort((a, b) => {
      if (b.evaluation_index !== a.evaluation_index) return b.evaluation_index - a.evaluation_index;
      const ts = compareNullableTimestamp(a.created_at, b.created_at, "desc");
      if (ts !== 0) return ts;
      return b.id.localeCompare(a.id);
    })
    .slice(0, cap)
    .map((t) => {
      const mse = toSortNumber(t.mse);
      const rmse = mse != null ? Math.sqrt(Math.max(0, mse)) : null;
      return {
        id: t.id,
        generation: toSortNumber(t.generation),
        evaluationNumber: toSortNumber(t.evaluation_index),
        metricValue: toSortNumber(t.metric_value),
        mse,
        rmse,
        durationMs: toSortNumber(t.elapsed_ms),
        finishedAt: t.created_at,
        source: "persisted",
        status: "finished",
        isBest: t.is_new_best === 1,
        hasPreviewRun: t.has_run_payload === true,
      };
    });
}

export function getDefaultOptimizationOverviewSort(): OptimizationOverviewSortState {
  return { key: "evaluation", direction: "desc" };
}

export function isOptimizationOverviewRowPreviewable(row: OptimizationOverviewRow): boolean {
  return row.status === "finished" && row.id.trim().length > 0 && row.hasPreviewRun;
}

export function deriveBestOptimizationOverviewRowId(input: {
  rows: OptimizationOverviewRow[];
  objective: OptimizationObjective;
}): string | null {
  const candidates = input.rows.filter((row) => {
    if (row.status !== "finished") return false;
    if (input.objective === "maximize") return row.metricValue != null;
    return row.rmse != null;
  });
  if (candidates.length === 0) return null;
  const sorted = candidates.slice().sort((a, b) => {
    const primary =
      input.objective === "maximize"
        ? compareNullableNumber(a.metricValue, b.metricValue, "desc")
        : compareNullableNumber(a.rmse, b.rmse, "asc");
    if (primary !== 0) return primary;
    const evalCmp = compareNullableNumber(a.evaluationNumber, b.evaluationNumber, "desc");
    if (evalCmp !== 0) return evalCmp;
    const finishedCmp = compareNullableTimestamp(a.finishedAt, b.finishedAt, "desc");
    if (finishedCmp !== 0) return finishedCmp;
    return b.id.localeCompare(a.id);
  });
  return sorted[0]?.id ?? null;
}

export function isOptimizationOverviewRowBest(row: OptimizationOverviewRow, bestTrialId: string | null): boolean {
  if (bestTrialId == null || bestTrialId.length === 0) return false;
  return row.id === bestTrialId;
}

export function deriveOptimizationTrialRunsCountText(input: {
  running: boolean;
  totalEvalCount: number;
  localWindowCount: number;
  overviewCount: number;
}): string {
  if (input.running) {
    if (input.totalEvalCount <= 0) return "No evaluations yet";
    if (input.localWindowCount < input.totalEvalCount) {
      return `Last ${input.localWindowCount.toLocaleString("en-US")} of ${input.totalEvalCount.toLocaleString("en-US")} evals (rolling window)`;
    }
    return `${input.totalEvalCount.toLocaleString("en-US")} evals`;
  }
  if (input.overviewCount > 0) return `${input.overviewCount.toLocaleString("en-US")} finished evals`;
  return "No evaluations yet";
}

/**
 * Caps heavy per-row rendering while local optimization is running so long sessions remain interactive.
 * Rows are still retained in state; this only limits the active DOM window.
 */
export function deriveOptimizationVisibleTrialRows<T>(input: {
  rows: readonly T[];
  running: boolean;
  maxLiveRows?: number;
}): T[] {
  if (!input.running) return input.rows.slice();
  const cap = Math.max(1, Math.floor(input.maxLiveRows ?? 80));
  if (input.rows.length <= cap) return input.rows.slice();
  return input.rows.slice(input.rows.length - cap);
}

export function shouldRefreshHydratedOverview(input: {
  snapshot: OptimizationProgressSnapshot | null;
  lastSnapshot: OptimizationProgressSnapshot | null;
  nowMs: number;
  lastFetchAtMs: number | null;
  maxIdleMs: number;
}): boolean {
  if (input.lastFetchAtMs == null) return true;
  const idleMs = Math.max(0, input.nowMs - input.lastFetchAtMs);
  if (idleMs >= Math.max(500, Math.floor(input.maxIdleMs))) return true;
  if (!input.snapshot || !input.lastSnapshot) return false;
  return (
    input.snapshot.evaluationIndex > input.lastSnapshot.evaluationIndex ||
    input.snapshot.generation > input.lastSnapshot.generation ||
    input.snapshot.trialCount > input.lastSnapshot.trialCount
  );
}

export function sortOptimizationOverviewRows(input: {
  rows: OptimizationOverviewRow[];
  key: OptimizationOverviewSortKey;
  direction: OptimizationOverviewSortDirection;
}): OptimizationOverviewRow[] {
  return input.rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const rowA = a.row;
      const rowB = b.row;
      let cmp = 0;
      switch (input.key) {
        case "evaluation":
          cmp = compareNullableNumber(rowA.evaluationNumber, rowB.evaluationNumber, input.direction);
          break;
        case "generation":
          cmp = compareNullableNumber(rowA.generation, rowB.generation, input.direction);
          break;
        case "metric":
          cmp = compareNullableNumber(rowA.metricValue, rowB.metricValue, input.direction);
          break;
        case "rmse":
          cmp = compareNullableNumber(rowA.rmse, rowB.rmse, input.direction);
          break;
        case "duration":
          cmp = compareNullableNumber(rowA.durationMs, rowB.durationMs, input.direction);
          break;
        case "finishedAt":
          cmp = compareNullableTimestamp(rowA.finishedAt, rowB.finishedAt, input.direction);
          break;
      }
      if (cmp !== 0) return cmp;
      return a.idx - b.idx;
    })
    .map((entry) => entry.row);
}

export function deriveOptimizationWaitingDiagnostics(input: {
  running: boolean;
  hasCurrentEvaluation: boolean;
  lastPersistedTrialAt: string | null;
  nowMs: number;
  staleThresholdMs?: number;
}): OptimizationWaitingDiagnostics {
  const staleThresholdMs = Math.max(1_000, Math.floor(input.staleThresholdMs ?? 30_000));
  const parsedLast = input.lastPersistedTrialAt ? Date.parse(input.lastPersistedTrialAt) : Number.NaN;
  const sinceLastTrialWriteMs =
    Number.isFinite(parsedLast) && input.nowMs >= parsedLast ? input.nowMs - parsedLast : null;

  if (input.running && input.hasCurrentEvaluation) {
    return {
      phase: "evaluating",
      lastPersistedTrialAt: input.lastPersistedTrialAt,
      sinceLastTrialWriteMs,
      staleThresholdMs,
      showLongWaitNote: false,
      message: "Simulation candidate is currently evaluating.",
    };
  }
  if (input.running) {
    const showLongWaitNote = sinceLastTrialWriteMs != null && sinceLastTrialWriteMs > staleThresholdMs;
    return {
      phase: showLongWaitNote ? "idle" : "waiting_to_persist",
      lastPersistedTrialAt: input.lastPersistedTrialAt,
      sinceLastTrialWriteMs,
      staleThresholdMs,
      showLongWaitNote,
      message: showLongWaitNote
        ? "No new persisted trial yet; this can happen during a long simulation tick or a heavy candidate evaluation."
        : "Waiting for the next trial result to be persisted.",
    };
  }
  return {
    phase: "idle",
    lastPersistedTrialAt: input.lastPersistedTrialAt,
    sinceLastTrialWriteMs,
    staleThresholdMs,
    showLongWaitNote: false,
    message: "Session is hydrated from persisted progress.",
  };
}

export function formatOptimizationDurationMs(durationMs: number | null): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)}s`;

  const totalSeconds = Math.floor(durationMs / 1_000);
  if (durationMs < 3_600_000) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}
