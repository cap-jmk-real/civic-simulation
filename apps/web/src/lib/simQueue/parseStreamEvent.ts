import { parseSimJobsListResponse, type SimJobSummaryDto } from "./parseJobsResponse";
import type { LabSessionQueueSummary } from "./labSessionsQueueUi";

export type QueueLabStreamPayload = {
  jobs: SimJobSummaryDto[];
  sessions: LabSessionQueueSummary[];
};

function isLabSessionQueueSummary(x: unknown): x is LabSessionQueueSummary {
  if (x == null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.sessionType === "string" &&
    typeof o.status === "string" &&
    typeof o.updatedAt === "string" &&
    (o.heartbeatAt === null || typeof o.heartbeatAt === "string") &&
    (o.statusNote === null || typeof o.statusNote === "string") &&
    typeof o.trialCount === "number" &&
    typeof o.cellCount === "number" &&
    (o.projectId === null || typeof o.projectId === "string")
  );
}

/**
 * Parses `MessageEvent.data` from GET /api/sim/stream.
 * Invalid jobs entries are dropped; sessions must all validate or the message fails.
 */
export function parseQueueLabStreamPayload(raw: string): { ok: true; data: QueueLabStreamPayload } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false };
  }
  if (parsed == null || typeof parsed !== "object") return { ok: false };
  const o = parsed as Record<string, unknown>;
  const jobsPart = parseSimJobsListResponse({ jobs: o.jobs, error: o.error });
  if (jobsPart.error) return { ok: false };
  const sessions = o.sessions;
  if (!Array.isArray(sessions)) return { ok: false };
  const normSessions: LabSessionQueueSummary[] = [];
  for (const s of sessions) {
    if (!isLabSessionQueueSummary(s)) return { ok: false };
    normSessions.push(s);
  }
  return { ok: true, data: { jobs: jobsPart.jobs, sessions: normSessions } };
}

export function formatSseDataLine(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}
