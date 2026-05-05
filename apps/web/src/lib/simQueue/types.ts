import type { SimConfig } from "@ip-sim/core";

export type SimJobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";

export type SimJobPolicyMode = "heuristic" | "qre";

export interface SimJobPayload {
  /** Merged with defaults in the worker via {@link mergeSimConfig}. */
  config: Partial<SimConfig>;
  policyMode: SimJobPolicyMode;
  qreTemp?: number;
}

export interface SimJobRow {
  id: string;
  status: SimJobStatus;
  created_at: string;
  updated_at: string;
  heartbeat_at: string | null;
  payload_json: string;
  error_text: string | null;
  result_json: string | null;
  progress_note: string | null;
  status_note: string | null;
}
