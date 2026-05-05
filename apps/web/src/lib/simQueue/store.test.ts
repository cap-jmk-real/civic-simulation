import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { SimJobPayload } from "./types";
import {
  claimNextQueuedJob,
  closeQueueDbForTesting,
  completeJobWithResult,
  getQueueDb,
  getJob,
  insertQueuedJob,
  listRecentJobs,
  tryCancelJob,
  updateJobProgress,
} from "./store";

const samplePayload = (): SimJobPayload => ({
  config: { ticks: 10, seed: 42 },
  policyMode: "heuristic",
});

function useTempDbPath() {
  const p = path.join(os.tmpdir(), `sim-queue-test-${randomUUID()}.db`);
  process.env.SIM_QUEUE_DB_PATH = p;
  return p;
}

afterEach(() => {
  const raw = process.env.SIM_QUEUE_DB_PATH?.trim();
  closeQueueDbForTesting();
  delete process.env.SIM_QUEUE_DB_PATH;
  if (raw && raw !== ":memory:" && fs.existsSync(raw)) {
    try {
      fs.unlinkSync(raw);
    } catch {
      /* ignore */
    }
  }
});

describe("simQueue store", () => {
  it("enqueue → claim → progress → complete", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(getJob(id)?.status).toBe("queued");
    expect(getJob(id)?.progress_note).toBeNull();

    const claimed = claimNextQueuedJob();
    expect(claimed).toBe(id);
    expect(getJob(id)?.status).toBe("running");
    expect(getJob(id)?.progress_note).toBe("starting…");

    updateJobProgress(id, "tick 3/10");
    expect(getJob(id)?.progress_note).toBe("tick 3/10");

    completeJobWithResult(id, '{"ok":true}');
    const row = getJob(id);
    expect(row?.status).toBe("done");
    expect(row?.progress_note).toBe("complete");
    expect(row?.result_json).toBe('{"ok":true}');

    updateJobProgress(id, "should not apply");
    expect(getJob(id)?.progress_note).toBe("complete");
  });

  it("does not write progress while job is still queued", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    updateJobProgress(id, "nope");
    expect(getJob(id)?.status).toBe("queued");
    expect(getJob(id)?.progress_note).toBeNull();
  });

  it("claim is FIFO", () => {
    useTempDbPath();
    const a = insertQueuedJob(samplePayload());
    const b = insertQueuedJob({ ...samplePayload(), config: { ...samplePayload().config, seed: 99 } });
    expect(claimNextQueuedJob()).toBe(a);
    expect(claimNextQueuedJob()).toBe(b);
    expect(claimNextQueuedJob()).toBeNull();
  });

  it("cancels queued job", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(tryCancelJob(id)).toBe("cancelled");
    expect(getJob(id)?.status).toBe("cancelled");
  });

  it("cancels running job and blocks terminal overwrite", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(claimNextQueuedJob()).toBe(id);
    expect(getJob(id)?.status).toBe("running");

    expect(tryCancelJob(id)).toBe("cancelled");
    expect(getJob(id)?.status).toBe("cancelled");

    completeJobWithResult(id, '{"ok":true}');
    expect(getJob(id)?.status).toBe("cancelled");
    expect(getJob(id)?.result_json).toBeNull();
  });

  it("returns clear cancel result for terminal states", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(claimNextQueuedJob()).toBe(id);
    completeJobWithResult(id, '{"ok":true}');

    expect(tryCancelJob(id)).toBe("already_terminal");
    expect(tryCancelJob("missing-id")).toBe("not_found");
  });

  it("keeps terminal status stable under double-complete and late-cancel races", () => {
    useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(claimNextQueuedJob()).toBe(id);

    completeJobWithResult(id, '{"ok":true}');
    completeJobWithResult(id, '{"ok":"second"}');
    expect(tryCancelJob(id)).toBe("already_terminal");

    const row = getJob(id);
    expect(row?.status).toBe("done");
    expect(row?.result_json).toBe('{"ok":true}');
  });

  it("marks stale running job as interrupted on startup recovery", () => {
    const dbPath = useTempDbPath();
    const id = insertQueuedJob(samplePayload());
    expect(claimNextQueuedJob()).toBe(id);
    closeQueueDbForTesting();

    const staleIso = "2020-01-01T00:00:00.000Z";
    const raw = new Database(dbPath);
    raw.prepare(`UPDATE jobs SET status = 'running', updated_at = ?, heartbeat_at = ?, progress_note = ? WHERE id = ?`).run(
      staleIso,
      staleIso,
      "tick 1/10",
      id,
    );
    raw.close();

    const recovered = getJob(id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.status_note).toContain("stale heartbeat");
    expect(recovered?.progress_note).toContain("tick");
  });

  it("migrates legacy jobs/lab_sessions before recovery and keeps init/list calls non-throwing", async () => {
    const dbPath = useTempDbPath();
    closeQueueDbForTesting();
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        error_text TEXT,
        result_json TEXT,
        progress_note TEXT,
        CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled'))
      );
      CREATE TABLE lab_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        project_id TEXT,
        meta_json TEXT NOT NULL DEFAULT '{}',
        best_trial_id TEXT,
        CHECK (session_type IN ('optimization', 'grid_batch')),
        CHECK (status IN ('running', 'complete', 'cancelled'))
      );
    `);
    raw
      .prepare(
        `INSERT INTO jobs (id, status, created_at, updated_at, payload_json, error_text, result_json, progress_note)
         VALUES (?, 'running', ?, ?, ?, NULL, NULL, ?)`,
      )
      .run("legacy-job", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", '{"config":{"ticks":1}}', "legacy");
    raw
      .prepare(
        `INSERT INTO lab_sessions (id, session_type, status, created_at, updated_at, project_id, meta_json, best_trial_id)
         VALUES (?, 'optimization', 'running', ?, ?, NULL, '{}', NULL)`,
      )
      .run("legacy-session", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
    raw.close();

    const { listLabSessions } = await import("./labSessionsStore");
    expect(() => listRecentJobs(10)).not.toThrow();
    expect(() => listLabSessions(10)).not.toThrow();

    const db = getQueueDb();
    const jobsColumns = (
      db.prepare(`PRAGMA table_info(jobs)`).all() as Array<{
        name: string;
      }>
    ).map((col) => col.name);
    const sessionColumns = (
      db.prepare(`PRAGMA table_info(lab_sessions)`).all() as Array<{
        name: string;
      }>
    ).map((col) => col.name);
    expect(jobsColumns).toEqual(expect.arrayContaining(["heartbeat_at", "status_note"]));
    expect(sessionColumns).toEqual(expect.arrayContaining(["heartbeat_at", "status_note"]));

    expect(() => db.prepare(`UPDATE jobs SET status = 'interrupted' WHERE id = ?`).run("legacy-job")).not.toThrow();
    expect(() => db.prepare(`UPDATE lab_sessions SET status = 'interrupted' WHERE id = ?`).run("legacy-session")).not.toThrow();
  });
});
