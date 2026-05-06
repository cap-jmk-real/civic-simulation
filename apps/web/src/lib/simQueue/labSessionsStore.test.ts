import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeOptimizationTrialId } from "./optimizationIds";
import { describeSqlite, withFreshQueueDb } from "./sqliteTestEnv";

const require = createRequire(import.meta.url);

function openRawDb(dbPath: string) {
  const mod = require("better-sqlite3") as { default?: unknown } | ((p: string) => unknown);
  const DatabaseCtor = (mod as { default?: unknown }).default ?? mod;
  return new (DatabaseCtor as new (p: string) => { exec: (s: string) => void; prepare: (s: string) => { run: (...args: unknown[]) => void }; close: () => void })(
    dbPath,
  );
}

describeSqlite("labSessionsStore / sim queue SQLite", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.SIM_QUEUE_DB_PATH;
  });

  it("creates parent dirs for a nested SIM_QUEUE_DB_PATH", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "deep", "nested", "queue.db");
    await withFreshQueueDb(dbPath, async () => {
      const { listLabSessions } = await import("./labSessionsStore");
      expect(listLabSessions(10)).toEqual([]);
    });
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("migrates legacy lab_sessions rows missing meta_json / project_id / best_trial_id", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "legacy.db");
    const raw = openRawDb(dbPath);
    raw.exec(`
      CREATE TABLE lab_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw.close();

    await withFreshQueueDb(dbPath, async () => {
      const { listLabSessions, upsertLabSession } = await import("./labSessionsStore");
      expect(() => listLabSessions(5)).not.toThrow();
      upsertLabSession({ id: "sess-legacy", sessionType: "optimization", meta: { n: 1 } });
      const rows = listLabSessions(10);
      expect(rows.some((r) => r.id === "sess-legacy")).toBe(true);
    });
  });

  it("migrates legacy lab_sessions rows missing optimization progress timing columns", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "legacy-opt-progress.db");
    const raw = openRawDb(dbPath);
    raw.exec(`
      CREATE TABLE lab_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        heartbeat_at TEXT,
        status_note TEXT,
        project_id TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        best_trial_id TEXT,
        CHECK (session_type IN ('optimization', 'grid_batch')),
        CHECK (status IN ('queued', 'running', 'complete', 'cancelled', 'interrupted'))
      );
    `);
    const t = new Date().toISOString();
    raw
      .prepare(
        `INSERT INTO lab_sessions (
          id, session_type, status, created_at, updated_at, heartbeat_at, status_note, project_id, meta_json, best_trial_id
        ) VALUES (?, 'optimization', 'running', ?, ?, ?, NULL, NULL, '{}', NULL)`,
      )
      .run("sess-legacy-opt", t, t, t);
    raw.close();

    await withFreshQueueDb(dbPath, async () => {
      const { getLabSession, patchOptimizationEvalProgress } = await import("./labSessionsStore");
      patchOptimizationEvalProgress("sess-legacy-opt", {
        currentGeneration: 1,
        currentEvaluationIndex: 7,
        currentEvaluationStartedAt: "2026-01-01T00:00:10.000Z",
        lastEvaluationDurationMs: 1234,
        lastEvaluationFinishedAt: "2026-01-01T00:00:11.234Z",
      });
      const row = getLabSession("sess-legacy-opt");
      expect(row?.opt_current_generation).toBe(1);
      expect(row?.opt_current_evaluation_index).toBe(7);
      expect(row?.opt_current_evaluation_started_at).toBe("2026-01-01T00:00:10.000Z");
      expect(row?.opt_last_evaluation_duration_ms).toBe(1234);
      expect(row?.opt_last_evaluation_finished_at).toBe("2026-01-01T00:00:11.234Z");
    });
  });

  it("cancels running sessions and rejects terminal ones", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "cancel.db");
    await withFreshQueueDb(dbPath, async () => {
      const { getLabSession, tryCancelLabSession, upsertLabSession } = await import("./labSessionsStore");
      upsertLabSession({
        id: "sess-running",
        sessionType: "optimization",
        status: "running",
        meta: {},
      });
      expect(tryCancelLabSession("sess-running")).toBe("cancelled");
      expect(getLabSession("sess-running")?.status).toBe("cancelled");
      expect(tryCancelLabSession("sess-running")).toBe("already_terminal");
      expect(tryCancelLabSession("missing-session")).toBe("not_found");
    });
  });

  it("does not flip cancelled session back to complete on late finalize", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "cancel-vs-complete.db");
    await withFreshQueueDb(dbPath, async () => {
      const { completeLabSession, getLabSession, upsertLabSession } = await import("./labSessionsStore");
      upsertLabSession({
        id: "sess-race",
        sessionType: "optimization",
        status: "running",
        meta: {},
      });
      completeLabSession("sess-race", "cancelled");
      expect(getLabSession("sess-race")?.status).toBe("cancelled");

      // Simulates a late "complete" patch racing after cancellation persistence.
      completeLabSession("sess-race", "complete", "trial-late");
      const row = getLabSession("sess-race");
      expect(row?.status).toBe("cancelled");
      expect(row?.best_trial_id).toBeNull();
    });
  });

  it("keeps cancellation idempotent under double-complete/double-cancel races", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "terminal-race.db");
    await withFreshQueueDb(dbPath, async () => {
      const { completeLabSession, getLabSession, upsertLabSession } = await import("./labSessionsStore");
      upsertLabSession({
        id: "sess-terminal",
        sessionType: "optimization",
        status: "running",
        meta: {},
      });

      completeLabSession("sess-terminal", "cancelled");
      completeLabSession("sess-terminal", "cancelled");
      completeLabSession("sess-terminal", "complete", "trial-ignored");
      completeLabSession("sess-terminal", "complete");

      const row = getLabSession("sess-terminal");
      expect(row?.status).toBe("cancelled");
      expect(row?.best_trial_id).toBeNull();
    });
  });

  it("returns persisted optimization progress only after trials exist", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "opt-progress.db");
    await withFreshQueueDb(dbPath, async () => {
      const { getOptimizationTrialProgress, upsertLabSession, upsertLabTrial } = await import("./labSessionsStore");
      upsertLabSession({
        id: "sess-opt",
        sessionType: "optimization",
        status: "running",
        meta: {},
      });
      expect(getOptimizationTrialProgress("sess-opt")).toBeNull();

      upsertLabTrial({
        sessionId: "sess-opt",
        trialId: "trial-3",
        generation: 1,
        evaluationIndex: 3,
        assignmentsJson: "{}",
        metricValue: 0.42,
        mse: 0.1,
        isNewBest: true,
        runSummaryJson: "{}",
      });
      upsertLabTrial({
        sessionId: "sess-opt",
        trialId: "trial-8",
        generation: 2,
        evaluationIndex: 8,
        assignmentsJson: "{}",
        metricValue: 0.55,
        mse: 0.08,
        isNewBest: true,
        runSummaryJson: "{}",
      });

      expect(getOptimizationTrialProgress("sess-opt")).toEqual({
        evaluation_index: 8,
        generation: 2,
        trial_count: 2,
      });
    });
  });

  it("does not collide lab_trials.id across sessions for same evaluation index", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "trial-id-collisions.db");
    await withFreshQueueDb(dbPath, async () => {
      const { listLabTrials, upsertLabSession, upsertLabTrial } = await import("./labSessionsStore");

      upsertLabSession({ id: "sess-a", sessionType: "optimization", status: "running", meta: {} });
      upsertLabSession({ id: "sess-b", sessionType: "optimization", status: "running", meta: {} });

      // Same evaluation index in two different sessions must not hit the PK uniqueness on lab_trials.id.
      upsertLabTrial({
        sessionId: "sess-a",
        trialId: makeOptimizationTrialId({ sessionId: "sess-a", evaluationNumber: 0 }),
        generation: 0,
        evaluationIndex: 0,
        assignmentsJson: "{}",
        metricValue: 0.1,
        mse: 1,
        isNewBest: false,
        runSummaryJson: "{}",
      });
      upsertLabTrial({
        sessionId: "sess-b",
        trialId: makeOptimizationTrialId({ sessionId: "sess-b", evaluationNumber: 0 }),
        generation: 0,
        evaluationIndex: 0,
        assignmentsJson: "{}",
        metricValue: 0.2,
        mse: 1,
        isNewBest: false,
        runSummaryJson: "{}",
      });

      expect(listLabTrials("sess-a").length).toBe(1);
      expect(listLabTrials("sess-b").length).toBe(1);
      expect(listLabTrials("sess-a")[0]!.id).not.toEqual(listLabTrials("sess-b")[0]!.id);
    });
  });

  it("marks non-best optimization trials previewable when fullRunJson is persisted", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "opt-preview-payload.db");
    await withFreshQueueDb(dbPath, async () => {
      const { getLabTrial, upsertLabSession, upsertLabTrial } = await import("./labSessionsStore");
      const { toOptimizationTrialSummary } = await import("./optimizationTrialSummary");

      upsertLabSession({ id: "sess-prev", sessionType: "optimization", status: "complete", meta: {} });
      upsertLabTrial({
        sessionId: "sess-prev",
        trialId: "trial-nonbest",
        generation: 0,
        evaluationIndex: 2,
        assignmentsJson: "{}",
        metricValue: 0.5,
        mse: 0.1,
        isNewBest: false,
        runSummaryJson: JSON.stringify({ tickCount: 1, seed: 99 }),
        fullRunJson: JSON.stringify({
          manifest: { schemaVersion: 1, seed: 99 },
          history: [{ metrics: { tick: 0, giniWealth: 0 } }],
        }),
      });
      const row = getLabTrial("sess-prev", "trial-nonbest");
      expect(row).toBeDefined();
      expect(toOptimizationTrialSummary(row!).has_run_payload).toBe(true);
    });
  });

  it("claims queued optimization sessions in FIFO order", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "opt-claim.db");
    await withFreshQueueDb(dbPath, async () => {
      const { claimNextQueuedOptimizationSession, getLabSession, upsertLabSession } = await import("./labSessionsStore");
      upsertLabSession({ id: "opt-2", sessionType: "optimization", status: "queued", meta: {} });
      upsertLabSession({ id: "grid-1", sessionType: "grid_batch", status: "queued", meta: {} });
      upsertLabSession({ id: "opt-1", sessionType: "optimization", status: "queued", meta: {} });

      expect(claimNextQueuedOptimizationSession()).toBe("opt-2");
      expect(getLabSession("opt-2")?.status).toBe("running");
      expect(claimNextQueuedOptimizationSession()).toBe("opt-1");
      expect(getLabSession("opt-1")?.status).toBe("running");
      expect(claimNextQueuedOptimizationSession()).toBeNull();
      expect(getLabSession("grid-1")?.status).toBe("queued");
    });
  });

  it("defaults optimization sessions to queued when status omitted", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "opt-default-status.db");
    await withFreshQueueDb(dbPath, async () => {
      const { claimNextQueuedOptimizationSession, getLabSession, upsertLabSession } = await import("./labSessionsStore");
      upsertLabSession({
        id: "opt-default",
        sessionType: "optimization",
        meta: { source: "test" },
      });

      expect(getLabSession("opt-default")?.status).toBe("queued");
      expect(claimNextQueuedOptimizationSession()).toBe("opt-default");
      expect(getLabSession("opt-default")?.status).toBe("running");
    });
  });

  it("marks stale running sessions as interrupted during startup recovery", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-simqueue-"));
    const dbPath = path.join(root, "stale-sessions.db");
    const raw = openRawDb(dbPath);
    raw.exec(`
      CREATE TABLE lab_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        heartbeat_at TEXT,
        status_note TEXT,
        project_id TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        best_trial_id TEXT,
        CHECK (session_type IN ('optimization', 'grid_batch')),
        CHECK (status IN ('running', 'complete', 'cancelled', 'interrupted'))
      );
    `);
    raw
      .prepare(
        `INSERT INTO lab_sessions (
          id, session_type, status, created_at, updated_at, heartbeat_at, status_note, project_id, meta_json, best_trial_id
        ) VALUES (?, 'optimization', 'running', ?, ?, ?, NULL, NULL, '{}', NULL)`,
      )
      .run("sess-stale", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    raw.close();

    await withFreshQueueDb(dbPath, async () => {
      const { getLabSession } = await import("./labSessionsStore");
      const row = getLabSession("sess-stale");
      expect(row?.status).toBe("interrupted");
      expect(row?.status_note).toContain("stale heartbeat");
    });
  });
});
