import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeOptimizationTrialId } from "./optimizationIds";

const require = createRequire(import.meta.url);

function hasNativeSqlite(): boolean {
  try {
    const mod = require("better-sqlite3") as { default?: unknown } | ((p: string) => unknown);
    const DatabaseCtor = (mod as { default?: unknown }).default ?? mod;
    const db = new (DatabaseCtor as new (p: string) => { close: () => void })(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

const describeSqlite = hasNativeSqlite() ? describe : describe.skip;

async function withFreshQueueDb(dbPath: string, fn: () => Promise<void>) {
  process.env.SIM_QUEUE_DB_PATH = dbPath;
  vi.resetModules();
  try {
    await fn();
  } finally {
    const { closeQueueDbForTesting } = await import("./store");
    closeQueueDbForTesting();
    delete process.env.SIM_QUEUE_DB_PATH;
    vi.resetModules();
  }
}

describeSqlite("optimization worker pipeline (SQLite)", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.SIM_QUEUE_DB_PATH;
  });

  it("claim queued session then persist trial with session-scoped id (worker contract)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-opt-pipeline-"));
    const dbPath = path.join(root, "pipeline.db");
    const sessionId = "sess-pipeline-1";

    await withFreshQueueDb(dbPath, async () => {
      const {
        claimNextQueuedOptimizationSession,
        getLabSession,
        listLabTrials,
        upsertLabSession,
        upsertLabTrial,
      } = await import("./labSessionsStore");

      upsertLabSession({ id: sessionId, sessionType: "optimization", status: "queued", meta: {} });
      expect(getLabSession(sessionId)?.status).toBe("queued");

      expect(claimNextQueuedOptimizationSession()).toBe(sessionId);
      expect(getLabSession(sessionId)?.status).toBe("running");

      const trialId = makeOptimizationTrialId({ sessionId, evaluationNumber: 0 });
      upsertLabTrial({
        sessionId,
        trialId,
        generation: 0,
        evaluationIndex: 0,
        assignmentsJson: "{}",
        metricValue: 0.5,
        mse: 0.1,
        isNewBest: true,
        runSummaryJson: "{}",
      });

      const trials = listLabTrials(sessionId);
      expect(trials).toHaveLength(1);
      expect(trials[0]!.id).toBe(trialId);
      expect(trials[0]!.evaluation_index).toBe(0);
    });
  });

  it("retry upsert for same evaluation is idempotent (no UNIQUE errors)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ip-web-opt-pipeline-"));
    const dbPath = path.join(root, "idempotent.db");
    const sessionId = "sess-pipeline-2";

    await withFreshQueueDb(dbPath, async () => {
      const { upsertLabSession, upsertLabTrial, listLabTrials } = await import("./labSessionsStore");

      upsertLabSession({ id: sessionId, sessionType: "optimization", status: "running", meta: {} });
      const trialId = makeOptimizationTrialId({ sessionId, evaluationNumber: 3 });
      const payload = {
        sessionId,
        trialId,
        generation: 1,
        evaluationIndex: 3,
        assignmentsJson: '{"k":1}',
        metricValue: 0.2,
        mse: 0.3,
        isNewBest: false,
        runSummaryJson: "{}",
      };

      upsertLabTrial(payload);
      upsertLabTrial({ ...payload, metricValue: 0.9, mse: 0.05, isNewBest: true });

      const trials = listLabTrials(sessionId);
      expect(trials).toHaveLength(1);
      expect(trials[0]!.metric_value).toBe(0.9);
      expect(trials[0]!.is_new_best).toBe(1);
    });
  });
});
