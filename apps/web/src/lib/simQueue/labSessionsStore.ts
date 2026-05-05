import fs from "node:fs";
import path from "node:path";
import { getQueueDb, SIM_RESULT_JSON_MAX_BYTES } from "./store";
import { getLabExportsDir, getSimQueueDataDir } from "./paths";

export type LabSessionType = "optimization" | "grid_batch";
export type LabSessionStatus = "queued" | "running" | "complete" | "cancelled" | "interrupted";

export type LabSessionRow = {
  id: string;
  session_type: LabSessionType;
  status: LabSessionStatus;
  created_at: string;
  updated_at: string;
  heartbeat_at: string | null;
  status_note: string | null;
  project_id: string | null;
  meta_json: string;
  best_trial_id: string | null;
};

export type LabTrialRow = {
  id: string;
  session_id: string;
  generation: number;
  evaluation_index: number;
  assignments_json: string;
  metric_value: number | null;
  mse: number;
  elapsed_ms: number | null;
  is_new_best: number;
  run_summary_json: string | null;
  spillover_path: string | null;
  created_at: string;
};

export type LabBatchCellRow = {
  id: string;
  session_id: string;
  cell_index: number;
  cell_client_id: string | null;
  label: string | null;
  assignments_json: string;
  run_summary_json: string | null;
  spillover_path: string | null;
  created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function writeLabSpillover(sessionId: string, fileName: string, json: string): string {
  const root = getLabExportsDir();
  const dir = path.join(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, json, "utf8");
  return path.relative(getSimQueueDataDir(), abs).replace(/\\/g, "/");
}

function mergeRunSummaryWithOptionalFullRun(
  sessionId: string,
  fileKey: string,
  runSummaryJson: string,
  fullRunJson: string | null | undefined,
): { run_summary_json: string; spillover_path: string | null } {
  let summaryObj: Record<string, unknown> = {};
  try {
    summaryObj = JSON.parse(runSummaryJson) as Record<string, unknown>;
  } catch {
    summaryObj = {};
  }
  let spill: string | null = null;

  if (fullRunJson && fullRunJson.length > 0) {
    const b = Buffer.byteLength(fullRunJson, "utf8");
    if (b <= SIM_RESULT_JSON_MAX_BYTES) {
      try {
        summaryObj._fullRun = JSON.parse(fullRunJson) as unknown;
      } catch {
        summaryObj._fullRunRaw = fullRunJson;
      }
    } else {
      const rel = writeLabSpillover(sessionId, `${fileKey}-full.json`, fullRunJson);
      spill = rel;
      summaryObj._fullRunRef = { _storedPath: rel, _bytes: b };
    }
  }

  let runSummary = JSON.stringify(summaryObj);
  if (Buffer.byteLength(runSummary, "utf8") > SIM_RESULT_JSON_MAX_BYTES) {
    const rel = writeLabSpillover(sessionId, `${fileKey}-bundle.json`, runSummary);
    spill = rel;
    runSummary = JSON.stringify({
      _storedPath: rel,
      _bytes: Buffer.byteLength(JSON.stringify(summaryObj), "utf8"),
    });
  }

  return { run_summary_json: runSummary, spillover_path: spill };
}

export function upsertLabSession(input: {
  id: string;
  sessionType: LabSessionType;
  status?: LabSessionStatus;
  projectId?: string | null;
  meta: unknown;
}): void {
  const db = getQueueDb();
  const t = nowIso();
  const status = input.status ?? (input.sessionType === "optimization" ? "queued" : "running");
  const metaJson = JSON.stringify(input.meta ?? {});
  const projectId = input.projectId ?? null;
  db.prepare(
    `INSERT INTO lab_sessions (
      id, session_type, status, created_at, updated_at, heartbeat_at, status_note, project_id, meta_json, best_trial_id
    )
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       heartbeat_at = excluded.heartbeat_at,
       project_id = COALESCE(excluded.project_id, lab_sessions.project_id),
       meta_json = excluded.meta_json`,
  ).run(input.id, input.sessionType, status, t, t, t, projectId, metaJson);
}

export function completeLabSession(id: string, status: LabSessionStatus, bestTrialId?: string | null): void {
  const db = getQueueDb();
  const t = nowIso();
  // Terminal transitions are monotonic: once cancelled/complete, never move back to queued/running
  // and never overwrite cancelled with complete due to late async writes.
  const whereStatus = status === "cancelled" ? "status IN ('queued', 'running', 'cancelled')" : "status = 'running'";
  const note =
    status === "cancelled" ? "cancelled by user" : status === "interrupted" ? "interrupted (owner exited)" : null;
  if (bestTrialId !== undefined) {
    db.prepare(
      `UPDATE lab_sessions
       SET updated_at = ?, heartbeat_at = ?, status = ?, status_note = ?, best_trial_id = ?
       WHERE id = ? AND ${whereStatus}`,
    ).run(t, t, status, note, bestTrialId, id);
  } else {
    db.prepare(
      `UPDATE lab_sessions
       SET updated_at = ?, heartbeat_at = ?, status = ?, status_note = ?
       WHERE id = ? AND ${whereStatus}`,
    ).run(t, t, status, note, id);
  }
}

export type CancelLabSessionResult = "cancelled" | "not_found" | "already_terminal";

export function tryCancelLabSession(id: string): CancelLabSessionResult {
  const db = getQueueDb();
  const row = db
    .prepare(`SELECT status FROM lab_sessions WHERE id = ?`)
    .get(id) as { status: LabSessionStatus } | undefined;
  if (!row) return "not_found";
  if (row.status !== "running" && row.status !== "queued") return "already_terminal";
  const t = nowIso();
  db.prepare(
    `UPDATE lab_sessions
     SET status = 'cancelled', updated_at = ?, heartbeat_at = ?, status_note = ?
     WHERE id = ? AND status IN ('queued', 'running')`,
  ).run(t, t, row.status === "queued" ? "cancelled before start" : "cancelled by user", id);
  return "cancelled";
}

export function heartbeatLabSession(id: string, note?: string) {
  const db = getQueueDb();
  const t = nowIso();
  if (note != null) {
    db.prepare(
      `UPDATE lab_sessions
       SET updated_at = ?, heartbeat_at = ?, status_note = ?
       WHERE id = ? AND status = 'running'`,
    ).run(t, t, note, id);
    return;
  }
  db.prepare(`UPDATE lab_sessions SET updated_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'`).run(t, t, id);
}

/** Atomically claim the oldest queued optimization session for backend execution. */
export function claimNextQueuedOptimizationSession(): string | null {
  const db = getQueueDb();
  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id
         FROM lab_sessions
         WHERE session_type = 'optimization' AND status = 'queued'
         ORDER BY datetime(created_at) ASC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;
    if (!row) return null;
    const t = nowIso();
    const upd = db
      .prepare(
        `UPDATE lab_sessions
         SET status = 'running', updated_at = ?, heartbeat_at = ?, status_note = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(t, t, "claimed by optimization worker", row.id);
    if (upd.changes === 0) return null;
    return row.id;
  });
  return claim();
}

export function upsertLabTrial(input: {
  sessionId: string;
  trialId: string;
  generation: number;
  evaluationIndex: number;
  assignmentsJson: string;
  metricValue: number | null;
  mse: number;
  elapsedMs?: number | null;
  isNewBest: boolean;
  runSummaryJson: string;
  fullRunJson?: string | null;
}): void {
  const db = getQueueDb();
  const t = nowIso();
  const { run_summary_json, spillover_path } = mergeRunSummaryWithOptionalFullRun(
    input.sessionId,
    `eval-${input.evaluationIndex}`,
    input.runSummaryJson,
    input.fullRunJson,
  );
  db.prepare(
    `INSERT INTO lab_trials (
      id, session_id, generation, evaluation_index, assignments_json,
      metric_value, mse, elapsed_ms, is_new_best, run_summary_json, spillover_path, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, evaluation_index) DO UPDATE SET
      id = excluded.id,
      generation = excluded.generation,
      assignments_json = excluded.assignments_json,
      metric_value = excluded.metric_value,
      mse = excluded.mse,
      elapsed_ms = excluded.elapsed_ms,
      is_new_best = excluded.is_new_best,
      run_summary_json = excluded.run_summary_json,
      spillover_path = excluded.spillover_path`,
  ).run(
    input.trialId,
    input.sessionId,
    input.generation,
    input.evaluationIndex,
    input.assignmentsJson,
    input.metricValue,
    input.mse,
    input.elapsedMs ?? null,
    input.isNewBest ? 1 : 0,
    run_summary_json,
    spillover_path,
    t,
  );
  db.prepare(`UPDATE lab_sessions SET updated_at = ?, heartbeat_at = ? WHERE id = ?`).run(t, t, input.sessionId);
}

export function upsertLabBatchCell(input: {
  sessionId: string;
  rowId: string;
  cellIndex: number;
  cellClientId: string | null;
  label: string | null;
  assignmentsJson: string;
  runSummaryJson: string;
  fullRunJson?: string | null;
}): void {
  const db = getQueueDb();
  const t = nowIso();
  const { run_summary_json, spillover_path } = mergeRunSummaryWithOptionalFullRun(
    input.sessionId,
    `cell-${input.cellIndex}`,
    input.runSummaryJson,
    input.fullRunJson,
  );
  db.prepare(
    `INSERT INTO lab_batch_cells (
      id, session_id, cell_index, cell_client_id, label, assignments_json,
      run_summary_json, spillover_path, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, cell_index) DO UPDATE SET
      id = excluded.id,
      cell_client_id = excluded.cell_client_id,
      label = excluded.label,
      assignments_json = excluded.assignments_json,
      run_summary_json = excluded.run_summary_json,
      spillover_path = excluded.spillover_path`,
  ).run(
    input.rowId,
    input.sessionId,
    input.cellIndex,
    input.cellClientId,
    input.label,
    input.assignmentsJson,
    run_summary_json,
    spillover_path,
    t,
  );
  db.prepare(`UPDATE lab_sessions SET updated_at = ?, heartbeat_at = ? WHERE id = ?`).run(t, t, input.sessionId);
}

export function listLabSessions(limit = 40): LabSessionRow[] {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_type, status, created_at, updated_at, project_id, meta_json, best_trial_id
       , heartbeat_at, status_note
       FROM lab_sessions ORDER BY datetime(updated_at) DESC LIMIT ?`,
    )
    .all(limit) as LabSessionRow[];
}

export function getLabSession(id: string): LabSessionRow | undefined {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_type, status, created_at, updated_at, project_id, meta_json, best_trial_id
       , heartbeat_at, status_note
       FROM lab_sessions WHERE id = ?`,
    )
    .get(id) as LabSessionRow | undefined;
}

export function countLabTrials(sessionId: string): number {
  const db = getQueueDb();
  const r = db.prepare(`SELECT COUNT(*) as c FROM lab_trials WHERE session_id = ?`).get(sessionId) as { c: number };
  return r.c;
}

export function countLabBatchCells(sessionId: string): number {
  const db = getQueueDb();
  const r = db
    .prepare(`SELECT COUNT(*) as c FROM lab_batch_cells WHERE session_id = ?`)
    .get(sessionId) as { c: number };
  return r.c;
}

export function listLabTrials(sessionId: string, limit = 2000): LabTrialRow[] {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_id, generation, evaluation_index, assignments_json, metric_value, mse, is_new_best,
              elapsed_ms, run_summary_json, spillover_path, created_at
       FROM lab_trials WHERE session_id = ? ORDER BY evaluation_index ASC LIMIT ?`,
    )
    .all(sessionId, limit) as LabTrialRow[];
}

export function getLabTrial(sessionId: string, trialId: string): LabTrialRow | undefined {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_id, generation, evaluation_index, assignments_json, metric_value, mse, is_new_best,
              elapsed_ms, run_summary_json, spillover_path, created_at
       FROM lab_trials
       WHERE session_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(sessionId, trialId) as LabTrialRow | undefined;
}

export type OptimizationTrialProgressRow = {
  evaluation_index: number;
  generation: number;
  trial_count: number;
};

export function getOptimizationTrialProgress(sessionId: string): OptimizationTrialProgressRow | null {
  const db = getQueueDb();
  const row = db
    .prepare(
      `SELECT
         COALESCE(MAX(evaluation_index), 0) as evaluation_index,
         COALESCE(MAX(generation), 0) as generation,
         COUNT(*) as trial_count
       FROM lab_trials
       WHERE session_id = ?`,
    )
    .get(sessionId) as OptimizationTrialProgressRow | undefined;
  if (!row || row.trial_count <= 0) return null;
  return row;
}

export function listLabBatchCells(sessionId: string, limit = 2000): LabBatchCellRow[] {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_id, cell_index, cell_client_id, label, assignments_json,
              run_summary_json, spillover_path, created_at
       FROM lab_batch_cells WHERE session_id = ? ORDER BY cell_index ASC LIMIT ?`,
    )
    .all(sessionId, limit) as LabBatchCellRow[];
}

export function getLabBatchCell(sessionId: string, cellId: string): LabBatchCellRow | undefined {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, session_id, cell_index, cell_client_id, label, assignments_json,
              run_summary_json, spillover_path, created_at
       FROM lab_batch_cells
       WHERE session_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(sessionId, cellId) as LabBatchCellRow | undefined;
}
