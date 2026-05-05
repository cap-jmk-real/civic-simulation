/** Normalizes GET /api/sim/jobs JSON for the queue UI (keeps parsing testable without Next). */

export type SimJobSummaryDto = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  policyMode: string;
  progress_note: string | null;
  status_note: string | null;
  error_text: string | null;
  hasResult: boolean;
};

export function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : null;
}

function normalizeJobSummary(x: unknown): SimJobSummaryDto | null {
  if (x == null || typeof x !== "object") return null;
  const j = x as Record<string, unknown>;
  if (typeof j.id !== "string" || typeof j.status !== "string") return null;
  return {
    id: j.id,
    status: j.status,
    created_at: typeof j.created_at === "string" ? j.created_at : "",
    updated_at: typeof j.updated_at === "string" ? j.updated_at : "",
    policyMode: typeof j.policyMode === "string" ? j.policyMode : "?",
    progress_note: nullableString(j.progress_note),
    status_note: nullableString(j.status_note),
    error_text: nullableString(j.error_text),
    hasResult: Boolean(j.hasResult),
  };
}

export function parseSimJobsListResponse(json: unknown): { jobs: SimJobSummaryDto[]; error?: string } {
  if (json == null || typeof json !== "object") {
    return { jobs: [], error: "Invalid response" };
  }
  const o = json as Record<string, unknown>;
  if (typeof o.error === "string") {
    return { jobs: [], error: o.error };
  }
  const jobs = o.jobs;
  if (!Array.isArray(jobs)) {
    return { jobs: [] };
  }
  return { jobs: jobs.map(normalizeJobSummary).filter((x): x is SimJobSummaryDto => x != null) };
}

export type SimJobDetailDto = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  heartbeat_at: string | null;
  progress_note: string | null;
  status_note: string | null;
  error_text: string | null;
  result_json: string | null;
  result_meta?: unknown;
  payload: unknown;
};

export function parseSimJobDetailResponse(json: unknown): { detail: SimJobDetailDto | null; error?: string } {
  if (json == null || typeof json !== "object") {
    return { detail: null, error: "Invalid response" };
  }
  const o = json as Record<string, unknown>;
  if (typeof o.error === "string") {
    return { detail: null, error: o.error };
  }
  if (typeof o.id !== "string" || typeof o.status !== "string") {
    return { detail: null, error: "Invalid job detail" };
  }
  return {
    detail: {
      id: o.id,
      status: o.status,
      created_at: typeof o.created_at === "string" ? o.created_at : "",
      updated_at: typeof o.updated_at === "string" ? o.updated_at : "",
      heartbeat_at: nullableString(o.heartbeat_at),
      progress_note: nullableString(o.progress_note),
      status_note: nullableString(o.status_note),
      error_text: nullableString(o.error_text),
      result_json: nullableString(o.result_json),
      result_meta: "result_meta" in o ? o.result_meta : null,
      payload: "payload" in o ? o.payload : null,
    },
  };
}
