import type { LabSessionStatus } from "./labSessionsStore";
import type { SimJobStatus } from "./types";

export type QueueType = "jobs" | "lab_sessions";
type Outcome = "completed" | "failed" | "cancelled";

export type QueueCounters = Record<QueueType, Record<Outcome | "claimed", number>>;

export type WorkerRuntimeDeps = {
  claimNextJob: () => string | null;
  claimNextOptimizationSession: () => string | null;
  processJob: (jobId: string) => Promise<void>;
  processOptimizationSession: (sessionId: string) => Promise<void>;
  getJobStatus: (jobId: string) => SimJobStatus | undefined;
  getOptimizationSessionStatus: (sessionId: string) => LabSessionStatus | undefined;
  sleep: (ms: number) => Promise<void>;
  log: (message: string, payload?: Record<string, unknown>) => void;
  /** stderr / structured log for handler failures (includes stack when Error). */
  logError?: (message: string, payload?: Record<string, unknown>) => void;
  /** Fires immediately after a row is claimed (queued → running). */
  onClaimed?: (info: { queueType: QueueType; id: string }) => void;
};

export type WorkerRuntimeConfig = {
  maxConcurrentSimJobs: number;
  maxConcurrentOptimizationSessions: number;
  activeSleepMs: number;
  idleSleepMs: number;
  busySleepMs: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function readWorkerRuntimeConfig(env: NodeJS.ProcessEnv): WorkerRuntimeConfig {
  return {
    maxConcurrentSimJobs: parsePositiveInt(env.SIM_WORKER_MAX_CONCURRENT_JOBS, 1),
    maxConcurrentOptimizationSessions: parsePositiveInt(env.SIM_WORKER_MAX_CONCURRENT_OPT_SESSIONS, 1),
    activeSleepMs: parsePositiveInt(env.SIM_WORKER_ACTIVE_SLEEP_MS, 80),
    busySleepMs: parsePositiveInt(env.SIM_WORKER_BUSY_SLEEP_MS, 200),
    idleSleepMs: parsePositiveInt(env.SIM_WORKER_IDLE_SLEEP_MS, 400),
  };
}

export function createEmptyCounters(): QueueCounters {
  return {
    jobs: { claimed: 0, completed: 0, failed: 0, cancelled: 0 },
    lab_sessions: { claimed: 0, completed: 0, failed: 0, cancelled: 0 },
  };
}

export class WorkerRuntime {
  private readonly inflightJobs = new Set<Promise<void>>();
  private readonly inflightOptimizationSessions = new Set<Promise<void>>();
  readonly counters: QueueCounters = createEmptyCounters();

  constructor(
    private readonly deps: WorkerRuntimeDeps,
    readonly config: WorkerRuntimeConfig,
  ) {}

  private emitCounterUpdate(queueType: QueueType, outcome: Outcome | "claimed", id: string) {
    const payload = {
      id,
      queueType,
      outcome,
      inFlight: {
        jobs: this.inflightJobs.size,
        lab_sessions: this.inflightOptimizationSessions.size,
      },
      counters: this.counters,
    };
    this.deps.log("Worker queue counter update", payload);
  }

  private recordClaim(queueType: QueueType, id: string) {
    this.counters[queueType].claimed += 1;
    this.emitCounterUpdate(queueType, "claimed", id);
    this.deps.onClaimed?.({ queueType, id });
  }

  private recordOutcome(queueType: QueueType, outcome: Outcome, id: string) {
    this.counters[queueType][outcome] += 1;
    this.emitCounterUpdate(queueType, outcome, id);
  }

  private classifyJobOutcome(status: SimJobStatus | undefined): Outcome {
    if (status === "done") return "completed";
    if (status === "cancelled") return "cancelled";
    return "failed";
  }

  private classifyOptimizationOutcome(status: LabSessionStatus | undefined): Outcome {
    if (status === "complete") return "completed";
    if (status === "cancelled" || status === "interrupted") return "cancelled";
    return "failed";
  }

  private launchJob(jobId: string) {
    this.recordClaim("jobs", jobId);
    const promise = this.deps
      .processJob(jobId)
      .then(() => {
        this.recordOutcome("jobs", this.classifyJobOutcome(this.deps.getJobStatus(jobId)), jobId);
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        this.deps.logError?.("Sim job handler failed", { jobId, error: e.message, stack: e.stack });
        this.recordOutcome("jobs", "failed", jobId);
      })
      .finally(() => {
        this.inflightJobs.delete(promise);
      });
    this.inflightJobs.add(promise);
  }

  private launchOptimizationSession(sessionId: string) {
    this.recordClaim("lab_sessions", sessionId);
    const promise = this.deps
      .processOptimizationSession(sessionId)
      .then(() => {
        this.recordOutcome(
          "lab_sessions",
          this.classifyOptimizationOutcome(this.deps.getOptimizationSessionStatus(sessionId)),
          sessionId,
        );
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        this.deps.logError?.("Optimization session handler failed", {
          sessionId,
          error: e.message,
          stack: e.stack,
        });
        this.recordOutcome("lab_sessions", "failed", sessionId);
      })
      .finally(() => {
        this.inflightOptimizationSessions.delete(promise);
      });
    this.inflightOptimizationSessions.add(promise);
  }

  getInFlightCounts() {
    return {
      jobs: this.inflightJobs.size,
      lab_sessions: this.inflightOptimizationSessions.size,
    };
  }

  hasInflight() {
    return this.inflightJobs.size > 0 || this.inflightOptimizationSessions.size > 0;
  }

  claimOnce(): { claimedJobs: number; claimedOptimizationSessions: number } {
    let claimedJobs = 0;
    let claimedOptimizationSessions = 0;

    while (this.inflightJobs.size < this.config.maxConcurrentSimJobs) {
      const jobId = this.deps.claimNextJob();
      if (!jobId) break;
      claimedJobs += 1;
      this.launchJob(jobId);
    }
    while (this.inflightOptimizationSessions.size < this.config.maxConcurrentOptimizationSessions) {
      const sessionId = this.deps.claimNextOptimizationSession();
      if (!sessionId) break;
      claimedOptimizationSessions += 1;
      this.launchOptimizationSession(sessionId);
    }
    return { claimedJobs, claimedOptimizationSessions };
  }

  async waitForInflight(): Promise<void> {
    await Promise.all([...this.inflightJobs, ...this.inflightOptimizationSessions]);
  }

  async sleepForBackpressure(claimedJobs: number, claimedOptimizationSessions: number): Promise<void> {
    if (claimedJobs > 0 || claimedOptimizationSessions > 0) {
      await this.deps.sleep(this.config.activeSleepMs);
      return;
    }
    if (this.hasInflight()) {
      await this.deps.sleep(this.config.busySleepMs);
      return;
    }
    await this.deps.sleep(this.config.idleSleepMs);
  }
}
