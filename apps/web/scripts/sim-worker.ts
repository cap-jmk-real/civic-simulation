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
import { buildCompactRunSummaryJson } from "../src/lib/labPersistenceClient";
import { fullRunJsonForLabTrialPersist } from "../src/lib/simQueue/labTrialFullRunPersist";
import type { GridAxisId } from "../src/lib/gridAxes";
import { readWorkerRuntimeConfig, WorkerRuntime } from "../src/lib/simQueue/workerRuntime";
import { buildOptimizationLogEvent } from "../src/lib/simQueue/optimizationLogging";
import { makeOptimizationTrialId } from "../src/lib/simQueue/optimizationIds";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
const logger = createBackendLogger("sim-worker");

/** Wall-clock ETA from average duration of finished evaluations (session-level, not per-tick inside one sim). */
function formatEtaMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function logOptimizationProgressLine(payload: Record<string, unknown>) {
  console.info("[sim-worker] optimization progress", payload);
  logger.info("Optimization progress", payload);
}

/** Interval while a single evaluation (full simulation) is in flight; 0 disables. */
function parseOptEvalProgressLogIntervalMs(): number {
  const raw = process.env.SIM_WORKER_OPT_PROGRESS_INTERVAL_MS?.trim();
  if (raw === "0" || raw === "") return 0;
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return n;
}

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
  if (!row) {
    const payload = buildOptimizationLogEvent("opt_session_error", { sessionId }, { reason: "row_missing" });
    console.error("[sim-worker]", payload);
    logger.error("Optimization session row missing", payload);
    return;
  }
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
    const payload = buildOptimizationLogEvent("opt_session_terminal", { sessionId }, { status: "cancelled", reason: "invalid_meta" });
    console.error("[sim-worker]", payload);
    logger.error("Optimization session meta invalid", payload);
    return;
  }

  let bestTrialId: string | null = null;
  const segPlanned = populationSize * generations;
  heartbeatLabSession(sessionId, `running optimization 0/${segPlanned}`);
  const sessionStartPayload = buildOptimizationLogEvent("opt_session_start", { sessionId }, {
    sessionType: row.session_type,
    populationSize,
    generations,
    metric,
    objective,
    mode,
    policyMode,
  });
  console.info("[sim-worker]", sessionStartPayload);
  logger.info("Optimization session start", sessionStartPayload);
  const evaluationStartTimes = new Map<number, number>();
  const sessionWallStartMs = Date.now();
  const evaluationNumberOffset =
    typeof meta.evaluationNumberOffset === "number" ? Math.max(0, Math.floor(meta.evaluationNumberOffset)) : 0;
  const evalProgressEveryMs = parseOptEvalProgressLogIntervalMs();
  let lastSimTickLogAt = 0;
  let evalRunningInterval: ReturnType<typeof setInterval> | null = null;
  const clearEvalRunningLog = () => {
    if (evalRunningInterval) {
      clearInterval(evalRunningInterval);
      evalRunningInterval = null;
    }
  };

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
      evaluationNumberOffset,
      generationDisplayOffset:
        typeof meta.generationDisplayOffset === "number" ? Math.max(0, Math.floor(meta.generationDisplayOffset)) : 0,
      onEvaluationBegin: (begin) => {
        clearEvalRunningLog();
        lastSimTickLogAt = 0;
        const { generation, evaluationNumber } = begin;
        const now = Date.now();
        evaluationStartTimes.set(evaluationNumber, now);
        const completedBefore = Math.max(0, evaluationNumber - evaluationNumberOffset - 1);
        const pctSession = segPlanned > 0 ? Number(((100 * completedBefore) / segPlanned).toFixed(1)) : 0;
        let etaRemainingMs: number | null = null;
        let etaRemaining = "—";
        if (completedBefore > 0) {
          const elapsed = now - sessionWallStartMs;
          const avgMs = elapsed / completedBefore;
          const remaining = segPlanned - completedBefore;
          etaRemainingMs = avgMs * remaining;
          etaRemaining = formatEtaMs(etaRemainingMs);
        }
        logOptimizationProgressLine({
          sessionId,
          phase: "eval_begin",
          generation,
          evaluationNumber,
          completedEvaluations: completedBefore,
          totalEvaluations: segPlanned,
          pctSession,
          etaRemaining,
          etaRemainingMs,
          note: "evaluation simulation starting (same engine as queue jobs; tick % logged below)",
        });
        const payload = buildOptimizationLogEvent("opt_session_evaluation_begin", { sessionId }, {
          generation,
          evaluationNumber,
          axisIds,
        });
        console.info("[sim-worker]", payload);
        logger.info("Optimization evaluation begin", payload);

        if (evalProgressEveryMs > 0) {
          const evalStartedAt = Date.now();
          evalRunningInterval = setInterval(() => {
            const evalElapsedMs = Date.now() - evalStartedAt;
            logOptimizationProgressLine({
              sessionId,
              phase: "eval_still_running",
              generation,
              evaluationNumber,
              completedEvaluations: completedBefore,
              totalEvaluations: segPlanned,
              pctSession,
              currentEvalElapsedMs: evalElapsedMs,
              currentEvalElapsed: formatEtaMs(evalElapsedMs),
              note: "simulation still running for this evaluation",
            });
          }, evalProgressEveryMs);
        }
      },
      shouldCancel: () => {
        const current = getLabSession(sessionId);
        return !current || current.status === "cancelled";
      },
      onEvaluationSimulationTick: (info) => {
        const now = Date.now();
        if (now - lastSimTickLogAt < 5000 && info.tick < info.ticks) return;
        lastSimTickLogAt = now;
        logOptimizationProgressLine({
          sessionId,
          phase: "eval_sim_tick",
          generation: info.generation,
          evaluationNumber: info.evaluationNumber,
          tick: info.tick,
          ticks: info.ticks,
          pctTicks: Number(info.pct.toFixed(1)),
          note: `eval ${info.evaluationNumber} sim ${info.tick}/${info.ticks} (${info.pct.toFixed(1)}%)`,
        });
      },
      onEvaluation: (ev: EvolutionaryEvaluationPayload) => {
        clearEvalRunningLog();
        const trialId = makeOptimizationTrialId({ sessionId, evaluationNumber: ev.evaluationNumber });
        const runSummaryJson = buildCompactRunSummaryJson(ev.run);
        const fullRunJson = fullRunJsonForLabTrialPersist(ev.run);
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
        const startedAt = evaluationStartTimes.get(ev.evaluationNumber);
        const elapsedMs = startedAt != null ? Date.now() - startedAt : undefined;
        const completed = Math.max(0, ev.evaluationNumber - evaluationNumberOffset);
        const pctSession = segPlanned > 0 ? Number(((100 * completed) / segPlanned).toFixed(1)) : 100;
        let etaRemainingMs: number | null = null;
        let etaRemaining = "—";
        if (completed >= segPlanned) {
          etaRemaining = "0s";
          etaRemainingMs = 0;
        } else if (completed > 0) {
          const elapsed = Date.now() - sessionWallStartMs;
          const avgMs = elapsed / completed;
          const remaining = segPlanned - completed;
          etaRemainingMs = avgMs * remaining;
          etaRemaining = formatEtaMs(etaRemainingMs);
        }
        logOptimizationProgressLine({
          sessionId,
          phase: "eval_done",
          generation: ev.generation,
          evaluationNumber: ev.evaluationNumber,
          completedEvaluations: completed,
          totalEvaluations: segPlanned,
          pctSession,
          etaRemaining,
          etaRemainingMs,
          lastEvalDurationMs: elapsedMs ?? null,
          lastEvalDuration: elapsedMs != null ? formatEtaMs(elapsedMs) : null,
        });
        const evalPayload = buildOptimizationLogEvent("opt_session_evaluation_end", { sessionId }, {
          generation: ev.generation,
          evaluationNumber: ev.evaluationNumber,
          mse: ev.mse,
          metricValue: ev.metricValue,
          isNewBest: ev.isNewBest,
          elapsedMs,
        });
        console.info("[sim-worker]", evalPayload);
        logger.info("Optimization evaluation end", evalPayload);

        const trialPayload = buildOptimizationLogEvent("opt_session_trial_persisted", { sessionId }, {
          trialId,
          generation: ev.generation,
          evaluationNumber: ev.evaluationNumber,
          isNewBest: ev.isNewBest,
        });
        console.info("[sim-worker]", trialPayload);
        logger.info("Optimization trial persisted", trialPayload);
      },
      onGeneration: (gen) => {
        heartbeatLabSession(sessionId, `running optimization ${gen.evaluations}/${segPlanned}`);
      },
    });
    const current = getLabSession(sessionId);
    if (!current || current.status === "cancelled" || out.cancelled) {
      completeLabSession(sessionId, "cancelled");
      const payload = buildOptimizationLogEvent("opt_session_terminal", { sessionId }, {
        status: "cancelled",
        reason: !current ? "row_missing_after_run" : out.cancelled ? "cancelled_flag" : "cancelled_status",
      });
      console.info("[sim-worker]", payload);
      logger.info("Optimization session cancelled", payload);
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
    const payload = buildOptimizationLogEvent("opt_session_terminal", { sessionId }, {
      status: "complete",
      bestTrialId,
      evaluations: out.evaluations,
      generationsCompleted: out.generationsCompleted,
    });
    console.info("[sim-worker]", payload);
    logger.info("Optimization session complete", payload);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const errorPayload = buildOptimizationLogEvent("opt_session_error", { sessionId }, {
      error: err.message,
      stack: err.stack,
    });
    console.error("[sim-worker]", errorPayload);
    logger.error("Optimization session failed", errorPayload);
    completeLabSession(sessionId, "cancelled");
    const terminalPayload = buildOptimizationLogEvent("opt_session_terminal", { sessionId }, {
      status: "cancelled",
      reason: "error",
    });
    console.info("[sim-worker]", terminalPayload);
    logger.warn("Optimization session cancelled after error", terminalPayload);
  } finally {
    clearEvalRunningLog();
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
