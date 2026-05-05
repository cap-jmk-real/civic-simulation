import type { SimJobDetailDto, SimJobSummaryDto } from "./parseJobsResponse";

type JobDebugInput = {
  summary: SimJobSummaryDto;
  detail?: SimJobDetailDto | null;
};

type RelatedIds = {
  sessionId: string | null;
  labSessionId: string | null;
  projectId: string | null;
};

function toRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function readNumber(record: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function extractPayload(detail: SimJobDetailDto | null | undefined): Record<string, unknown> | null {
  return toRecord(detail?.payload);
}

function extractConfig(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  return toRecord(payload?.config);
}

function extractRelatedIds(payload: Record<string, unknown> | null, config: Record<string, unknown> | null): RelatedIds {
  const runRef = toRecord(payload?.runRef);
  return {
    sessionId:
      readString(payload, "sessionId", "session_id") ??
      readString(config, "sessionId", "session_id") ??
      (readString(runRef, "kind") === "lab_session" ? readString(runRef, "id") : null),
    labSessionId: readString(payload, "labSessionId", "lab_session_id") ?? readString(config, "labSessionId", "lab_session_id"),
    projectId: readString(payload, "projectId", "project_id") ?? readString(config, "projectId", "project_id"),
  };
}

function parseResultJson(resultJson: string | null | undefined): Record<string, unknown> | null {
  if (!resultJson) return null;
  try {
    return toRecord(JSON.parse(resultJson));
  } catch {
    return null;
  }
}

function detectStoredPath(detail: SimJobDetailDto | null | undefined): string | null {
  const fromMeta = readString(toRecord(detail?.result_meta), "storedPath");
  if (fromMeta) return fromMeta;
  const parsed = parseResultJson(detail?.result_json);
  return readString(parsed, "_storedPath");
}

function detectOutputBytes(detail: SimJobDetailDto | null | undefined): number | null {
  const fromMeta = readNumber(toRecord(detail?.result_meta), "outputBytes");
  if (fromMeta != null) return fromMeta;
  if (!detail?.result_json) return null;
  return new TextEncoder().encode(detail.result_json).length;
}

function detectElapsedMs(summary: SimJobSummaryDto, detail: SimJobDetailDto | null | undefined): number | null {
  const candidate = readNumber(toRecord(detail?.result_meta), "elapsedMs");
  if (candidate != null) return candidate;
  const startedAt = Date.parse(detail?.created_at ?? summary.created_at);
  const endedAt = Date.parse(detail?.updated_at ?? summary.updated_at);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function maybeNumber(value: number | null): string {
  return value == null ? "n/a" : String(value);
}

function maybeString(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "n/a";
}

export function formatSimJobDebugPayload(input: JobDebugInput): string {
  const summary = input.summary;
  const detail = input.detail ?? null;
  const payload = extractPayload(detail);
  const config = extractConfig(payload);
  const relatedIds = extractRelatedIds(payload, config);
  const n = readNumber(config, "n");
  const ticks = readNumber(config, "ticks");
  const randomSeed = readNumber(config, "seed", "randomSeed", "simSeed");
  const policyMode = readString(payload, "policyMode") ?? summary.policyMode ?? "unknown";
  const progress = detail?.progress_note ?? summary.progress_note ?? null;
  const errorText = detail?.error_text ?? summary.error_text ?? null;
  const elapsedMs = detectElapsedMs(summary, detail);
  const outputBytes = detectOutputBytes(detail);
  const storedPath = detectStoredPath(detail);
  const compact = {
    job: {
      id: summary.id,
      status: detail?.status ?? summary.status,
      createdAt: detail?.created_at ?? summary.created_at,
      updatedAt: detail?.updated_at ?? summary.updated_at,
      progressNote: progress,
    },
    request: {
      policyMode,
      n,
      ticks,
      randomSeed,
    },
    result: {
      error: errorText,
      elapsedMs,
      outputBytes,
      storedPath,
    },
    related: relatedIds,
  };

  return [
    "Simulation queue debug payload",
    `job.id: ${summary.id}`,
    `job.status: ${detail?.status ?? summary.status}`,
    `job.created_at: ${detail?.created_at ?? summary.created_at}`,
    `job.updated_at: ${detail?.updated_at ?? summary.updated_at}`,
    `job.progress_note: ${maybeString(progress)}`,
    `request.policy_mode: ${policyMode}`,
    `request.n: ${maybeNumber(n)}`,
    `request.ticks: ${maybeNumber(ticks)}`,
    `request.random_seed: ${maybeNumber(randomSeed)}`,
    `result.error: ${maybeString(errorText)}`,
    `result.elapsed_ms: ${maybeNumber(elapsedMs)}`,
    `result.output_bytes: ${maybeNumber(outputBytes)}`,
    `result.stored_path: ${maybeString(storedPath)}`,
    `related.session_id: ${maybeString(relatedIds.sessionId)}`,
    `related.lab_session_id: ${maybeString(relatedIds.labSessionId)}`,
    `related.project_id: ${maybeString(relatedIds.projectId)}`,
    "",
    "json:",
    JSON.stringify(compact, null, 2),
  ].join("\n");
}
