import type { SimJobSummaryDto } from "./parseJobsResponse";
import type { LabSessionQueueSummary } from "./labSessionsQueueUi";

export type WorkerHealthState = {
  workerLikelyDown: boolean;
  queuedJobs: number;
  oldestQueuedAgeMs: number | null;
};

const DEFAULT_STARTUP_GRACE_MS = 20_000;

function safeAgeMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

export function deriveWorkerHealthState(
  jobs: SimJobSummaryDto[],
  sessions: LabSessionQueueSummary[],
  opts?: { nowMs?: number; startupGraceMs?: number },
): WorkerHealthState {
  const nowMs = opts?.nowMs ?? Date.now();
  const startupGraceMs = opts?.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;

  const queuedJobs = jobs.filter((job) => job.status === "queued");
  if (queuedJobs.length === 0) {
    return { workerLikelyDown: false, queuedJobs: 0, oldestQueuedAgeMs: null };
  }

  let oldestQueuedAgeMs = 0;
  for (const job of queuedJobs) {
    const age = safeAgeMs(job.created_at, nowMs);
    if (age == null) continue;
    oldestQueuedAgeMs = Math.max(oldestQueuedAgeMs, age);
  }

  if (oldestQueuedAgeMs < startupGraceMs) {
    return { workerLikelyDown: false, queuedJobs: queuedJobs.length, oldestQueuedAgeMs };
  }

  const hasRunningJob = jobs.some((job) => job.status === "running");
  const hasRunningSession = sessions.some((session) => session.status === "running");

  return {
    workerLikelyDown: !hasRunningJob && !hasRunningSession,
    queuedJobs: queuedJobs.length,
    oldestQueuedAgeMs,
  };
}

export function formatAgeShort(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}
