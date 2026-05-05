import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimNextQueuedJob,
  closeQueueDbForTesting,
  completeJobWithResult,
  failJob,
  getJob,
  getJobStatus,
  insertQueuedJob,
  listRecentJobs,
  tryCancelJob,
} from "./store";
import {
  claimNextQueuedOptimizationSession,
  completeLabSession,
  getLabSession,
  upsertLabSession,
} from "./labSessionsStore";
import { WorkerRuntime, readWorkerRuntimeConfig } from "./workerRuntime";

function tempDbPath() {
  return path.join(os.tmpdir(), `sim-worker-runtime-${randomUUID()}.db`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function newRuntime(config?: Partial<ReturnType<typeof readWorkerRuntimeConfig>>) {
  const logs: Array<{ message: string; payload?: Record<string, unknown> }> = [];
  const runtime = new WorkerRuntime(
    {
      claimNextJob: claimNextQueuedJob,
      claimNextOptimizationSession: claimNextQueuedOptimizationSession,
      processJob: async (jobId) => {
        completeJobWithResult(jobId, '{"ok":true}');
      },
      processOptimizationSession: async (sessionId) => {
        completeLabSession(sessionId, "complete");
      },
      getJobStatus,
      getOptimizationSessionStatus: (id) => getLabSession(id)?.status,
      sleep,
      log: (message, payload) => {
        logs.push({ message, payload });
      },
    },
    {
      ...readWorkerRuntimeConfig(process.env),
      ...config,
    },
  );
  return { runtime, logs };
}

afterEach(() => {
  const raw = process.env.SIM_QUEUE_DB_PATH?.trim();
  closeQueueDbForTesting();
  delete process.env.SIM_QUEUE_DB_PATH;
  vi.resetModules();
  if (raw && raw !== ":memory:" && fs.existsSync(raw)) {
    try {
      fs.unlinkSync(raw);
    } catch {
      /* ignore */
    }
  }
});

describe("workerRuntime", () => {
  it("claims enqueue paths for sim jobs and optimization sessions", async () => {
    process.env.SIM_QUEUE_DB_PATH = tempDbPath();
    const simId = insertQueuedJob({ config: { seed: 1, ticks: 5 }, policyMode: "heuristic" });
    upsertLabSession({ id: "opt-1", sessionType: "optimization", status: "queued", meta: {} });

    const { runtime } = newRuntime({ maxConcurrentSimJobs: 2, maxConcurrentOptimizationSessions: 2 });
    const claimed = runtime.claimOnce();
    expect(claimed).toEqual({ claimedJobs: 1, claimedOptimizationSessions: 1 });
    await runtime.waitForInflight();

    expect(getJob(simId)?.status).toBe("done");
    expect(getLabSession("opt-1")?.status).toBe("complete");
    expect(runtime.counters.jobs).toEqual({ claimed: 1, completed: 1, failed: 0, cancelled: 0 });
    expect(runtime.counters.lab_sessions).toEqual({ claimed: 1, completed: 1, failed: 0, cancelled: 0 });
  });

  it("respects sim concurrency cap while queue has backlog", async () => {
    process.env.SIM_QUEUE_DB_PATH = tempDbPath();
    for (let i = 0; i < 5; i += 1) {
      insertQueuedJob({ config: { seed: i + 1, ticks: 5 }, policyMode: "heuristic" });
    }

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new WorkerRuntime(
      {
        claimNextJob: claimNextQueuedJob,
        claimNextOptimizationSession: claimNextQueuedOptimizationSession,
        processJob: async (_jobId) => {
          await gate;
        },
        processOptimizationSession: async () => {
          /* no-op */
        },
        getJobStatus,
        getOptimizationSessionStatus: (id) => getLabSession(id)?.status,
        sleep,
        log: () => {
          /* ignore */
        },
      },
      {
        ...readWorkerRuntimeConfig(process.env),
        maxConcurrentSimJobs: 2,
        maxConcurrentOptimizationSessions: 1,
      },
    );

    const firstClaim = runtime.claimOnce();
    expect(firstClaim.claimedJobs).toBe(2);
    expect(firstClaim.claimedOptimizationSessions).toBe(0);
    const rows = listRecentJobs(10);
    expect(rows.filter((row) => row.status === "running")).toHaveLength(2);
    expect(rows.filter((row) => row.status === "queued")).toHaveLength(3);

    release();
    await runtime.waitForInflight();
  });

  it("drains concurrent queues to terminal states", async () => {
    process.env.SIM_QUEUE_DB_PATH = tempDbPath();
    for (let i = 0; i < 3; i += 1) {
      insertQueuedJob({ config: { seed: 10 + i, ticks: 5 }, policyMode: "heuristic" });
      upsertLabSession({ id: `opt-${i}`, sessionType: "optimization", status: "queued", meta: {} });
    }

    const { runtime } = newRuntime({ maxConcurrentSimJobs: 2, maxConcurrentOptimizationSessions: 2 });
    for (let i = 0; i < 10; i += 1) {
      const claimed = runtime.claimOnce();
      await runtime.sleepForBackpressure(claimed.claimedJobs, claimed.claimedOptimizationSessions);
      await runtime.waitForInflight();
    }

    const simRows = listRecentJobs(10);
    expect(simRows.filter((row) => row.status === "done")).toHaveLength(3);
    expect(simRows.filter((row) => row.status === "queued" || row.status === "running")).toHaveLength(0);
    for (let i = 0; i < 3; i += 1) {
      expect(getLabSession(`opt-${i}`)?.status).toBe("complete");
    }
  });

  it("tracks cancelled and failed counters by queue type", async () => {
    process.env.SIM_QUEUE_DB_PATH = tempDbPath();
    const cancelledJob = insertQueuedJob({ config: { seed: 1, ticks: 5 }, policyMode: "heuristic" });
    const failedJob = insertQueuedJob({ config: { seed: 2, ticks: 5 }, policyMode: "heuristic" });
    upsertLabSession({ id: "opt-cancel", sessionType: "optimization", status: "queued", meta: {} });
    upsertLabSession({ id: "opt-fail", sessionType: "optimization", status: "queued", meta: {} });

    const runtime = new WorkerRuntime(
      {
        claimNextJob: claimNextQueuedJob,
        claimNextOptimizationSession: claimNextQueuedOptimizationSession,
        processJob: async (jobId) => {
          if (jobId === cancelledJob) {
            tryCancelJob(jobId);
            return;
          }
          failJob(jobId, "boom");
        },
        processOptimizationSession: async (sessionId) => {
          if (sessionId === "opt-cancel") {
            completeLabSession(sessionId, "cancelled");
            return;
          }
          throw new Error("worker blew up");
        },
        getJobStatus,
        getOptimizationSessionStatus: (id) => getLabSession(id)?.status,
        sleep,
        log: () => {
          /* no-op */
        },
      },
      {
        ...readWorkerRuntimeConfig(process.env),
        maxConcurrentSimJobs: 2,
        maxConcurrentOptimizationSessions: 2,
      },
    );

    const claimed = runtime.claimOnce();
    expect(claimed).toEqual({ claimedJobs: 2, claimedOptimizationSessions: 2 });
    await runtime.waitForInflight();

    expect(getJob(cancelledJob)?.status).toBe("cancelled");
    expect(getJob(failedJob)?.status).toBe("failed");
    expect(runtime.counters.jobs.cancelled).toBe(1);
    expect(runtime.counters.jobs.failed).toBe(1);
    expect(runtime.counters.lab_sessions.cancelled).toBe(1);
    expect(runtime.counters.lab_sessions.failed).toBe(1);
  });
});
