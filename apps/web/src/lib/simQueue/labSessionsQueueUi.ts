import { countLabBatchCells, countLabTrials, listLabSessions } from "./labSessionsStore";

/** Subset of GET /api/lab/sessions rows used by the queue panel + SSE. */
export type LabSessionQueueSummary = {
  id: string;
  sessionType: string;
  status: string;
  updatedAt: string;
  heartbeatAt: string | null;
  statusNote: string | null;
  trialCount: number;
  cellCount: number;
  projectId: string | null;
};

export function listLabSessionsForQueueUi(limit = 50): LabSessionQueueSummary[] {
  const sessions = listLabSessions(limit);
  return sessions.map((s) => ({
    id: s.id,
    sessionType: s.session_type,
    status: s.status,
    updatedAt: s.updated_at,
    heartbeatAt: s.heartbeat_at,
    statusNote: s.status_note,
    trialCount: s.session_type === "optimization" ? countLabTrials(s.id) : 0,
    cellCount: s.session_type === "grid_batch" ? countLabBatchCells(s.id) : 0,
    projectId: s.project_id,
  }));
}
