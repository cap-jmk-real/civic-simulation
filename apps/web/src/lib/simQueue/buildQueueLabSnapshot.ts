import { listRecentJobSummaries } from "./jobListSummary";
import { listLabSessionsForQueueUi, type LabSessionQueueSummary } from "./labSessionsQueueUi";
import type { SimJobSummaryDto } from "./parseJobsResponse";

export type QueueLabSnapshot = {
  jobs: SimJobSummaryDto[];
  sessions: LabSessionQueueSummary[];
};

/** SQLite-backed snapshot for GET /api/sim/jobs and SSE (worker updates visible via polling). */
export function buildQueueLabSnapshot(): QueueLabSnapshot {
  return {
    jobs: listRecentJobSummaries(50),
    sessions: listLabSessionsForQueueUi(50),
  };
}
