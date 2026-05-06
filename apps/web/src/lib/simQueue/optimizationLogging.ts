export type OptimizationLogEventName =
  | "opt_session_start"
  | "opt_session_evaluation_begin"
  | "opt_session_evaluation_end"
  | "opt_session_trial_persisted"
  | "opt_session_terminal"
  | "opt_session_error";

export type LabEvalEventType =
  | "opt_session_start"
  | "opt_eval_begin"
  | "opt_eval_heartbeat"
  | "opt_eval_end"
  | "opt_trial_persisted"
  | "opt_session_terminal"
  | "opt_session_error";

export type OptimizationLogBase = {
  /** Optimization lab session id (DB primary key). */
  sessionId: string;
};

/**
 * Build a structured optimization log payload.
 *
 * Always includes `event` and `sessionId` so downstream tooling can filter
 * and correlate logs across different transports (console + backend file).
 */
export function buildOptimizationLogEvent(
  event: OptimizationLogEventName,
  base: OptimizationLogBase,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...extra,
    event,
    sessionId: base.sessionId,
  };
}

const LAB_EVENT_LABELS: Record<LabEvalEventType, { short: string; long: string }> = {
  opt_session_start: { short: "start", long: "Session started" },
  opt_eval_begin: { short: "eval+", long: "Evaluation started" },
  opt_eval_heartbeat: { short: "hb", long: "Evaluation heartbeat" },
  opt_eval_end: { short: "eval-", long: "Evaluation finished" },
  opt_trial_persisted: { short: "trial", long: "Trial persisted" },
  opt_session_terminal: { short: "term", long: "Terminal event" },
  opt_session_error: { short: "err", long: "Worker error" },
};

/**
 * Accept console/worker log event names as aliases for persisted DB event types.
 * This keeps the UI resilient if older sessions (or external tools) wrote
 * `opt_session_*` names into `lab_eval_events.event_type`.
 */
const LAB_EVENT_ALIASES: Record<string, LabEvalEventType> = {
  opt_session_evaluation_begin: "opt_eval_begin",
  opt_session_evaluation_end: "opt_eval_end",
  opt_session_trial_persisted: "opt_trial_persisted",
};

export function formatLabEvalEventType(type: string | null | undefined): { short: string; long: string } {
  if (!type) return { short: "?", long: "Unknown" };
  const canonical = LAB_EVENT_ALIASES[type] ?? type;
  const mapped = (LAB_EVENT_LABELS as Record<string, { short: string; long: string }>)[canonical];
  return mapped ?? { short: "?", long: "Unknown" };
}

export function formatWorkerMetricValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(3);
  const s = v.toPrecision(6);
  // Normalize `toPrecision`’s trailing zeros for compact display.
  return s.replace(/(\.\d*?[1-9])0+$/g, "$1").replace(/\.0+$/g, "");
}

