import type { LabSessionQueueSummary } from "./labSessionsQueueUi";

type LabSessionDebugDetail = {
  id: string;
  sessionType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  bestTrialId: string | null;
  trialCount: number;
  cellCount: number;
  meta: unknown;
};

type LabSessionDebugInput = {
  summary: LabSessionQueueSummary;
  detail?: LabSessionDebugDetail | null;
};

const META_KEYS_SAFE = [
  "label",
  "mode",
  "policyMode",
  "gridConstruction",
  "levelProductLabel",
  "sessionMode",
  "metric",
  "objective",
  "target",
  "populationSize",
  "generations",
  "plannedTotalRuns",
  "runnableTotal",
  "plannedGridN",
  "cohortPlannedN",
  "ticks",
  "maxEvalBudget",
  "baseSeed",
  "lastPersistedTrialAt",
] as const;

function maybeString(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "n/a";
}

function maybeNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "n/a";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readSafeMetaSummary(meta: unknown): Record<string, string | number | boolean | null> {
  const record = readRecord(meta);
  if (!record) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of META_KEYS_SAFE) {
    const value = record[key];
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value as string | number | boolean | null;
    }
  }
  return out;
}

function derivePlanned(detail: LabSessionDebugDetail | null, summary: LabSessionQueueSummary): number | null {
  const rowCount = summary.sessionType === "optimization" ? summary.trialCount : summary.cellCount;
  const meta = readRecord(detail?.meta);
  if (!meta) return rowCount > 0 ? rowCount : null;
  if (summary.sessionType === "optimization") {
    const pop = meta.populationSize;
    const gens = meta.generations;
    if (typeof pop === "number" && Number.isFinite(pop) && typeof gens === "number" && Number.isFinite(gens)) {
      return Math.max(0, Math.floor(pop) * Math.floor(gens));
    }
  }
  const plannedCandidates = [meta.plannedTotalRuns, meta.runnableTotal];
  for (const candidate of plannedCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return Math.max(0, Math.floor(candidate));
  }
  return rowCount > 0 ? rowCount : null;
}

function readLastWriteHint(detail: LabSessionDebugDetail | null): string | null {
  const meta = readRecord(detail?.meta);
  if (!meta) return null;
  const fromMeta = meta.lastPersistedTrialAt;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  return null;
}

export function formatLabSessionDebugPayload(input: LabSessionDebugInput): string {
  const summary = input.summary;
  const detail = input.detail ?? null;
  const status = detail?.status ?? summary.status;
  const createdAt = detail?.createdAt ?? "n/a";
  const updatedAt = detail?.updatedAt ?? summary.updatedAt;
  const trialCount = detail?.trialCount ?? summary.trialCount;
  const cellCount = detail?.cellCount ?? summary.cellCount;
  const evaluations = summary.sessionType === "optimization" ? trialCount : cellCount;
  const planned = derivePlanned(detail, summary);
  const projectId = detail?.projectId ?? summary.projectId ?? null;
  const bestTrialId = detail?.bestTrialId ?? null;
  const lastWriteAt = readLastWriteHint(detail);
  const metaSummary = readSafeMetaSummary(detail?.meta);

  const compact = {
    session: {
      id: summary.id,
      type: summary.sessionType,
      status,
      createdAt,
      updatedAt,
    },
    rows: {
      trials: trialCount,
      cells: cellCount,
      planned,
      evaluations,
    },
    related: {
      bestTrialId,
      projectId,
    },
    progressHints: {
      lastWriteAt,
    },
    projectMetaSummary: metaSummary,
  };

  return [
    "Lab session debug payload",
    `session.id: ${summary.id}`,
    `session.type: ${summary.sessionType}`,
    `session.status: ${status}`,
    `session.created_at: ${createdAt}`,
    `session.updated_at: ${updatedAt}`,
    `rows.trials: ${maybeNumber(trialCount)}`,
    `rows.cells: ${maybeNumber(cellCount)}`,
    `rows.planned: ${maybeNumber(planned)}`,
    `rows.evaluations: ${maybeNumber(evaluations)}`,
    `related.best_trial_id: ${maybeString(bestTrialId)}`,
    `related.project_id: ${maybeString(projectId)}`,
    `progress.last_write_at: ${maybeString(lastWriteAt)}`,
    "",
    "json:",
    JSON.stringify(compact, null, 2),
  ].join("\n");
}
