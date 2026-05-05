import { listRecentJobs } from "./store";
import type { SimJobPayload, SimJobPolicyMode } from "./types";
import type { SimJobSummaryDto } from "./parseJobsResponse";

function summarizeJobRow(r: ReturnType<typeof listRecentJobs>[number]): SimJobSummaryDto {
  let policyMode: SimJobPolicyMode | string = "?";
  try {
    const p = JSON.parse(r.payload_json) as SimJobPayload;
    policyMode = p.policyMode;
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    policyMode,
    progress_note: r.progress_note,
    status_note: r.status_note,
    error_text: r.error_text,
    hasResult: r.result_json != null && r.result_json.length > 0,
  };
}

/** Same shape as GET /api/sim/jobs for list + SSE snapshots. */
export function listRecentJobSummaries(limit = 50): SimJobSummaryDto[] {
  return listRecentJobs(limit).map(summarizeJobRow);
}
