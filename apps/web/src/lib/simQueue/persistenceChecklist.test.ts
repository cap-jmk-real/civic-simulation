import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextQueuedJob,
  closeQueueDbForTesting,
  completeJobWithResult,
  getQueueDb,
  insertQueuedJob,
  updateJobProgress,
} from "./store";
import {
  claimNextQueuedOptimizationSession,
  completeLabSession,
  upsertLabBatchCell,
  upsertLabSession,
  upsertLabTrial,
} from "./labSessionsStore";
import type { SimJobPayload } from "./types";

function createTempDbPath(): string {
  return path.join(os.tmpdir(), `sim-queue-persistence-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function setFreshDbEnv(): string {
  const dbPath = createTempDbPath();
  process.env.SIM_QUEUE_DB_PATH = dbPath;
  return dbPath;
}

const sampleJobPayload: SimJobPayload = {
  config: { ticks: 10, seed: 123 },
  policyMode: "heuristic",
};

afterEach(() => {
  const dbPath = process.env.SIM_QUEUE_DB_PATH?.trim();
  closeQueueDbForTesting();
  delete process.env.SIM_QUEUE_DB_PATH;
  if (dbPath && dbPath !== ":memory:" && fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // best effort cleanup for test DB files
    }
  }
});

describe("DB persistence checklist", () => {
  it("enqueue single persists jobs row and completion result", () => {
    setFreshDbEnv();
    const jobId = insertQueuedJob(sampleJobPayload);

    expect(claimNextQueuedJob()).toBe(jobId);
    updateJobProgress(jobId, "tick 5/10");
    completeJobWithResult(jobId, '{"ok":true,"score":0.91}');

    const row = getQueueDb()
      .prepare(`SELECT id, status, result_json, progress_note FROM jobs WHERE id = ?`)
      .get(jobId) as { id: string; status: string; result_json: string | null; progress_note: string | null } | undefined;

    expect(row).toEqual({
      id: jobId,
      status: "done",
      result_json: '{"ok":true,"score":0.91}',
      progress_note: "complete",
    });
  });

  it("grid session persists lab_sessions + linked lab_batch_cells", () => {
    setFreshDbEnv();
    const sessionId = "sess-grid-1";
    upsertLabSession({
      id: sessionId,
      sessionType: "grid_batch",
      meta: { objective: "mse", gridSize: 1 },
      projectId: "project-grid",
    });
    upsertLabBatchCell({
      sessionId,
      rowId: "cell-row-1",
      cellIndex: 0,
      cellClientId: "client-cell-0",
      label: "baseline",
      assignmentsJson: '{"x":1}',
      runSummaryJson: '{"mse":1.23}',
      fullRunJson: null,
    });
    completeLabSession(sessionId, "complete");

    const session = getQueueDb()
      .prepare(`SELECT id, session_type, status, project_id FROM lab_sessions WHERE id = ?`)
      .get(sessionId) as
      | { id: string; session_type: string; status: string; project_id: string | null }
      | undefined;
    const cell = getQueueDb()
      .prepare(`SELECT id, session_id, cell_index, label FROM lab_batch_cells WHERE session_id = ?`)
      .get(sessionId) as { id: string; session_id: string; cell_index: number; label: string | null } | undefined;

    expect(session).toEqual({
      id: sessionId,
      session_type: "grid_batch",
      status: "complete",
      project_id: "project-grid",
    });
    expect(cell).toEqual({
      id: "cell-row-1",
      session_id: sessionId,
      cell_index: 0,
      label: "baseline",
    });
  });

  it("optimization session persists lab_sessions + linked lab_trials", () => {
    setFreshDbEnv();
    const sessionId = "sess-opt-1";
    upsertLabSession({
      id: sessionId,
      sessionType: "optimization",
      meta: { objective: "mse", population: 8 },
      projectId: "project-opt",
    });

    const queuedSession = getQueueDb()
      .prepare(`SELECT id, status, best_trial_id FROM lab_sessions WHERE id = ?`)
      .get(sessionId) as { id: string; status: string; best_trial_id: string | null } | undefined;

    expect(queuedSession).toEqual({
      id: sessionId,
      status: "queued",
      best_trial_id: null,
    });

    expect(claimNextQueuedOptimizationSession()).toBe(sessionId);

    upsertLabTrial({
      sessionId,
      trialId: "trial-1",
      generation: 0,
      evaluationIndex: 0,
      assignmentsJson: '{"alpha":0.2}',
      metricValue: 0.42,
      mse: 0.42,
      isNewBest: true,
      runSummaryJson: '{"mse":0.42}',
      fullRunJson: null,
    });
    completeLabSession(sessionId, "complete", "trial-1");

    const session = getQueueDb()
      .prepare(`SELECT id, session_type, status, best_trial_id FROM lab_sessions WHERE id = ?`)
      .get(sessionId) as
      | { id: string; session_type: string; status: string; best_trial_id: string | null }
      | undefined;
    const trial = getQueueDb()
      .prepare(`SELECT id, session_id, generation, evaluation_index FROM lab_trials WHERE session_id = ?`)
      .get(sessionId) as
      | { id: string; session_id: string; generation: number; evaluation_index: number }
      | undefined;

    expect(session).toEqual({
      id: sessionId,
      session_type: "optimization",
      status: "complete",
      best_trial_id: "trial-1",
    });
    expect(trial).toEqual({
      id: "trial-1",
      session_id: sessionId,
      generation: 0,
      evaluation_index: 0,
    });
  });
});
