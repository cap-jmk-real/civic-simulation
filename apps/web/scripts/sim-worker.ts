/**
 * Long-lived Node worker: polls SQLite for queued sim jobs and runs them with @ip-sim/core
 * (TypeScript heuristic / QRE — not browser WASM).
 *
 * Run from repo: `pnpm sim:worker` (root) or `pnpm sim:worker` in apps/web.
 */
import path from "node:path";
import {
  heuristicPolicy,
  mergeSimConfig,
  qrePolicy,
  runSimulationCooperative,
  serializeRun,
  type AgentState,
  type WorldState,
} from "@ip-sim/core";
import {
  claimNextQueuedJob,
  completeJobWithResult,
  failJob,
  getJob,
  getJobStatus,
  heartbeatJob,
  updateJobProgress,
} from "../src/lib/simQueue/store";
import {
  claimNextQueuedOptimizationSession,
  completeLabSession,
  getLabSession,
  getOptimizationTrialProgress,
  heartbeatLabSession,
  upsertLabTrial,
} from "../src/lib/simQueue/labSessionsStore";
import { getSimQueueDbPath } from "../src/lib/simQueue/paths";
import type { SimJobPayload } from "../src/lib/simQueue/types";
import { createBackendLogger } from "../src/lib/backendLogger";
import {
  readOptimizationMetric,
  runEvolutionarySearch,
  type EvolutionaryEvaluationPayload,
  type OptimizationMetricKey,
  type OptimizationObjective,
  type OptimizationPolicyMode,
} from "../src/lib/evolutionaryOptimize";
import { buildCompactRunSummaryJson, optionalFullRunJsonUnderCap } from "../src/lib/labPersistenceClient";
import type { GridAxisId } from "../src/lib/gridAxes";
import { readWorkerRuntimeConfig, WorkerRuntime } from "../src/lib/simQueue/workerRuntime";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
const logger = createBackendLogger("sim-worker");

type OptimizationSessionMeta = {
  mode?: unknown;
  policyMode?: unknown;
  qreTemp?: unknown;
  axisIds?: unknown;
  metric?: unknown;
  objective?: unknown;
  target?: unknown;
  maxAgentsCap?: unknown;
  populationSize?: unknown;
  generations?: unknown;
  mutationRate?: unknown;
  evaluationNumberOffset?: unknown;
  generationDisplayOffset?: unknown;
  baseConfig?: unknown;
};

async function runOneJob(jobId: string) {
  const row = getJob(jobId);
  if (!row) {
    failJob(jobId, "Job row missing after claim");
    return;
  }
  let payload: SimJobPayload;
  try {
    payload = JSON.parse(row.payload_json) as SimJobPayload;
  } catch (e) {
    failJob(jobId, e instanceof Error ? e.message : "Invalid payload JSON");
    return;
  }

  const config = mergeSimConfig(payload.config as Parameters<typeof mergeSimConfig>[0]);
  const qreTemp = payload.policyMode === "qre" ? (payload.qreTemp ?? 0.65) : undefined;
  const manifestBase = {
    seed: config.seed,
    policyMode: payload.policyMode,
    qreTemperature: qreTemp,
    queuedJobId: jobId,
  };

  const baseDecide =
    payload.policyMode === "heuristic"
      ? (_w: WorldState, agent: AgentState) => heuristicPolicy(agent, _w)
      : (w: WorldState, agent: AgentState) =>
          qrePolicy(agent, w, { temperature: qreTemp ?? 0.65, seedSalt: config.seed });

  let lastReportedTick = Number.NaN;
  let lastProgressLogAt = 0;
  let lastHeartbeatAt = 0;
  const HEARTBEAT_EVERY_MS = 3_000;
  const progressStride = Math.max(1, Math.floor(config.ticks / 40) || 1);
  const decide = (w: WorldState, agent: AgentState) => {
    const now = Date.now();
    if (now - lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
      lastHeartbeatAt = now;
      heartbeatJob(jobId);
    }
    if (w.tick !== lastReportedTick) {
      lastReportedTick = w.tick;
      if (w.tick % progressStride === 0 || w.tick === 0) {
        const at = Math.min(w.tick + 1, config.ticks);
        const note = `tick ${at}/${config.ticks}`;
        updateJobProgress(jobId, note);
        if (Date.now() - lastProgressLogAt >= 5_000 || at === config.ticks) {
          lastProgressLogAt = Date.now();
          logger.info("Job progress", { id: jobId, progress: note });
        }
      }
    }
    return baseDecide(w, agent);
  };

  try {
    const result = await runSimulationCooperative({
      config,
      manifest: manifestBase,
      decide,
      tickYieldInterval: Math.max(1, Math.floor(config.ticks / 20) || 1),
      shouldCancel: () => getJobStatus(jobId) === "cancelled",
      yieldToUi: async () => {
        /* yields keep Node responsive; tick progress comes from decide() */
      },
    });

    const histLen = result.history.length;
    updateJobProgress(jobId, `tick ${histLen}/${config.ticks} · serializing`);

    const { finalWorld: _fw, cancelled: _c, ...rest } = result as typeof result & {
      cancelled?: boolean;
      finalWorld?: unknown;
    };
    const cancelled = getJobStatus(jobId) === "cancelled" || result.cancelled === true;
    if (cancelled) {
      logger.warn("Job cancelled during run", { id: jobId });
      return;
    }
    const json = serializeRun(rest);
    completeJobWithResult(jobId, json);
    logger.info("Job completed", { id: jobId, historyLen: histLen });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    failJob(jobId, error);
    logger.error("Job failed", { id: jobId, error });
  }
}

function isOptimizationMetricKey(v: unknown): v is OptimizationMetricKey {
  return (
    v === "giniWealth" ||
    v === "meanWealth" ||
    v === "innovationFlow" ||
    v === "innovationFlowPerAgent" ||
    v === "totalWealth" ||
    v === "top10WealthShare" ||
    v === "innovationFlowPerMeanWealth"
  );
}

function isOptimizationObjective(v: unknown): v is OptimizationObjective {
  return v === "target" || v === "maximize";
}

function isOptimizationPolicyMode(v: unknown): v is OptimizationPolicyMode {
  return v === "heuristic" || v === "qre";
}

async function runOneOptimizationSession(sessionId: string) {
  const row = getLabSession(sessionId);
  if (!row) return;
  const meta = (JSON.parse(row.meta_json) ?? {}) as OptimizationSessionMeta;
  const axisIds = Array.isArray(meta.axisIds) ? (meta.axisIds.filter((v): v is GridAxisId => typeof v === "string") as GridAxisId[]) : [];
  const metric = isOptimizationMetricKey(meta.metric) ? meta.metric : null;
  const objective = isOptimizationObjective(meta.objective) ? meta.objective : null;
  const policyMode = isOptimizationPolicyMode(meta.policyMode) ? meta.policyMode : null;
  const mode = meta.mode === "qre" ? "qre" : meta.mode === "heuristic" ? "heuristic" : null;
  const qreTemp = typeof meta.qreTemp === "number" && Number.isFinite(meta.qreTemp) ? meta.qreTemp : 0.65;
  const populationSize = typeof meta.populationSize === "number" ? Math.max(1, Math.floor(meta.populationSize)) : 0;
  const generations = typeof meta.generations === "number" ? Math.max(1, Math.floor(meta.generations)) : 0;
  const mutationRate = typeof meta.mutationRate === "number" ? meta.mutationRate : 0.12;
  const target = typeof meta.target === "number" ? meta.target : 0;
  const baseConfig = meta.baseConfig as Parameters<typeof mergeSimConfig>[0] | undefined;
  if (!baseConfig || !mode || !policyMode || !metric || !objective || axisIds.length === 0 || populationSize < 1 || generations < 1) {
    completeLabSession(sessionId, "cancelled");
    logger.error("Optimization session meta invalid", { sessionId });
    return;
  }

  let bestTrialId: string | null = null;
  const segPlanned = populationSize * generations;
  heartbeatLabSession(sessionId, `running optimization 0/${segPlanned}`);
  try {
    const out = await runEvolutionarySearch({
      baseConfig: mergeSimConfig(baseConfig),
      mode,
      policyMode,
      qreTemp,
      axisIds,
      metric,
      target,
      objective,
      maxAgentsCap: typeof meta.maxAgentsCap === "number" ? meta.maxAgentsCap : null,
      populationSize,
      generations,
      mutationRate,
      evaluationNumberOffset:
        typeof meta.evaluationNumberOffset === "number" ? Math.max(0, Math.floor(meta.evaluationNumberOffset)) : 0,
      generationDisplayOffset:
        typeof meta.generationDisplayOffset === "number" ? Math.max(0, Math.floor(meta.generationDisplayOffset)) : 0,
      shouldCancel: () => {
        const current = getLabSession(sessionId);
        return !current || current.status === "cancelled";
      },
      onEvaluation: (ev: EvolutionaryEvaluationPayload) => {
        const trialId = `opt_e_${ev.evaluationNumber}_${mergeSimConfig(baseConfig).seed}`;
        const runSummaryJson = buildCompactRunSummaryJson(ev.run);
        const fullRunJson = ev.isNewBest ? optionalFullRunJsonUnderCap(ev.run) : null;
        upsertLabTrial({
          sessionId,
          trialId,
          generation: ev.generation,
          evaluationIndex: ev.evaluationNumber,
          assignmentsJson: JSON.stringify(ev.assignments),
          metricValue: ev.metricValue,
          mse: ev.mse,
          isNewBest: ev.isNewBest,
          runSummaryJson,
          fullRunJson,
        });
        if (ev.isNewBest) bestTrialId = trialId;
      },
      onGeneration: (gen) => {
        heartbeatLabSession(sessionId, `running optimization ${gen.evaluations}/${segPlanned}`);
      },
    });
    const current = getLabSession(sessionId);
    if (!current || current.status === "cancelled" || out.cancelled) {
      completeLabSession(sessionId, "cancelled");
      return;
    }
    const progress = getOptimizationTrialProgress(sessionId);
    const done = progress?.trial_count ?? out.evaluations;
    const metricLast = out.bestRun.history[out.bestRun.history.length - 1];
    heartbeatLabSession(
      sessionId,
      `optimization complete ${done}/${segPlanned}` +
        (metricLast ? ` · metric ${readOptimizationMetric(metricLast, metric).toPrecision(4)}` : ""),
    );
    completeLabSession(sessionId, "complete", bestTrialId);
  } catch (e) {
    logger.error("Optimization session failed", { sessionId, error: e instanceof Error ? e.message : String(e) });
    completeLabSession(sessionId, "cancelled");
  }
}

function parseIdleLogMs(): number {
  const raw = process.env.SIM_WORKER_IDLE_LOG_MS?.trim();
  if (raw === "0" || raw === "") return 0;
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return n;
}

async function main() {
  const dis = process.env.SIM_WORKER_ENABLED;
  if (dis === "0" || dis === "false") {
    console.error("[sim-worker] SIM_WORKER_ENABLED is off — exiting.");
    logger.warn("Worker disabled by SIM_WORKER_ENABLED");
    process.exit(0);
  }

  const runtimeConfig = readWorkerRuntimeConfig(process.env);
  const dbPathResolved = path.resolve(getSimQueueDbPath());
  const simQueueDbPathEnv = process.env.SIM_QUEUE_DB_PATH?.trim() || null;
  const idleLogMs = parseIdleLogMs();
  let lastIdleLogAt = 0;

  const startupMeta = {
    pid: process.pid,
    node: process.version,
    cwd: process.cwd(),
    dbPath: dbPathResolved,
    SIM_QUEUE_DB_PATH: simQueueDbPathEnv,
    concurrency: {
      maxConcurrentSimJobs: runtimeConfig.maxConcurrentSimJobs,
      maxConcurrentOptimizationSessions: runtimeConfig.maxConcurrentOptimizationSessions,
    },
    backpressureMs: {
      active: runtimeConfig.activeSleepMs,
      busy: runtimeConfig.busySleepMs,
      idle: runtimeConfig.idleSleepMs,
    },
    idleLogMs,
  };
  console.info("[sim-worker] started", startupMeta);
  console.info("[sim-worker] Polling for queued jobs (Ctrl+C to stop)…");
  logger.info("Worker started", startupMeta);

  const logError = (message: string, payload?: Record<string, unknown>) => {
    console.error(`[sim-worker] ${message}`, payload ?? {});
    logger.error(message, payload);
  };

  const runtime = new WorkerRuntime(
    {
      claimNextJob: claimNextQueuedJob,
      claimNextOptimizationSession: claimNextQueuedOptimizationSession,
      processJob: runOneJob,
      processOptimizationSession: runOneOptimizationSession,
      getJobStatus,
      getOptimizationSessionStatus: (sessionId) => getLabSession(sessionId)?.status,
      sleep,
      log: (message, payload) => logger.info(message, payload),
      logError,
      onClaimed: ({ queueType, id }) => {
        if (queueType === "jobs") {
          const line = { kind: "sim_job" as const, id, transition: "queued -> running" as const };
          console.info("[sim-worker] claimed work", line);
          logger.info("Claimed sim job", line);
          return;
        }
        const row = getLabSession(id);
        const line = {
          kind: "lab_session" as const,
          id,
          session_type: row?.session_type ?? null,
          transition: "queued -> running" as const,
        };
        console.info("[sim-worker] claimed work", line);
        logger.info("Claimed lab session", line);
      },
    },
    runtimeConfig,
  );
  for (;;) {
    try {
      const { claimedJobs, claimedOptimizationSessions } = runtime.claimOnce();
      if (claimedJobs > 0 || claimedOptimizationSessions > 0) {
        const summary = {
          claimedJobs,
          claimedOptimizationSessions,
          inFlight: runtime.getInFlightCounts(),
        };
        console.info("[sim-worker] claim batch", summary);
        logger.info("Worker claimed queued items", summary);
      } else if (!runtime.hasInflight() && idleLogMs > 0) {
        const now = Date.now();
        if (now - lastIdleLogAt >= idleLogMs) {
          lastIdleLogAt = now;
          const idleLine = {
            dbPath: dbPathResolved,
            SIM_QUEUE_DB_PATH: simQueueDbPathEnv,
            inFlight: runtime.getInFlightCounts(),
          };
          console.info("[sim-worker] idle (no queued rows to claim)", idleLine);
          logger.info("Worker idle heartbeat", idleLine);
        }
      }
      await runtime.sleepForBackpressure(claimedJobs, claimedOptimizationSessions);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      logError("Claim loop error", { error: e.message, stack: e.stack });
      await sleep(Math.min(5_000, runtimeConfig.idleSleepMs * 4));
    }
  }
}

main().catch((e) => {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error("[sim-worker] fatal", err);
  logger.error("Worker crashed", { error: err.message, stack: err.stack });
  process.exit(1);
});
