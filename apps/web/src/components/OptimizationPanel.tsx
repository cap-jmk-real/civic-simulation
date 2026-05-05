"use client";

import { type SimConfig } from "@ip-sim/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParamHelp } from "@/components/ParamHelp";
import {
  formatAxisCellValue,
  getGridAxisDefinition,
  GRID_ABS_MAX_RUNS,
  GRID_AXIS_DEFINITIONS,
  type GridAxisId,
} from "@/lib/gridAxes";
import { hamiltonAllocateCountsFromWeights } from "@/lib/percentPopulation";
import { totalAgents } from "@/lib/populationPresets";
import type { GridCellResult } from "@/lib/gridBatchTypes";
import {
  OPTIMIZATION_METRIC_LABELS,
  readOptimizationMetric,
  type OptimizationMetricKey,
  type OptimizationObjective,
  type OptimizationPolicyMode,
} from "@/lib/evolutionaryOptimize";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import {
  clearActiveLabJob,
  clearActiveLabJobIfId,
  getLabTabId,
  isOptimizationProgress,
  LAB_JOB_HEARTBEAT_MS,
  newLabJobId,
  patchActiveLabJob,
  readActiveLabJob,
  setActiveLabJob,
  subscribeLabJobs,
  type LabJobOptimizationProgress,
} from "@/lib/labJobStore";
import {
  persistLabSessionCreate,
} from "@/lib/labPersistenceClient";
import { reviveStoredSingleRun } from "@/lib/analysisStorage";
import type { LabSessionHydrationSummary } from "@/lib/simQueue/activeRunHydration";
import {
  deriveSessionOptimizationSettings,
  deriveBestOptimizationOverviewRowId,
  deriveHydratedOptimizationOverviewRows,
  deriveHydratedOptimizationLiveProgress,
  deriveOptimizationTrialRunsCountText,
  deriveOptimizationVisibleTrialRows,
  formatOptimizationDurationMs,
  getDefaultOptimizationOverviewSort,
  isOptimizationOverviewRowBest,
  isOptimizationOverviewRowPreviewable,
  deriveOptimizationWaitingDiagnostics,
  sortOptimizationOverviewRows,
  shouldRefreshHydratedOverview,
  type OptimizationOverviewSortDirection,
  type OptimizationOverviewSortKey,
  type OptimizationProgressSnapshot,
  type PersistedOptimizationTrial,
} from "@/lib/simQueue/optimizationLiveProgress";

const DEFAULT_OPT_AXES: GridAxisId[] = ["policy.enforcementIntensity", "policy.openScienceSubsidy"];

/** Soft cap for GA population size input; hard cap is max eval budget (and absolute grid ceiling). */
const OPT_GA_MAX_POPULATION = 256;
const OPT_MAX_SIM_TICKS = 100_000;
/** Rolling UI cap for optimization rows; keep memory bounded under long sessions. */
const MAX_OPT_TRIAL_ROWS = 120;

type OptTrialRow = {
  id: string;
  generation: number;
  evaluationNumber: number;
  metricValue: number | null;
  mse: number;
  finishedAt: string | null;
  label: string;
  giniWealth: number | null;
  meanWealth: number | null;
  innovationPerAgent: number | null;
  /** Only retained for leader local preview; other rows hydrate from persistence. */
  previewRun: GridCellResult["run"] | null;
  /** Wall time for this simulation only */
  durationMs: number | null;
};

function formatMsClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  if (s >= 10) return `${s}s`;
  if (s >= 1) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatOptimizationMetricCell(key: OptimizationMetricKey, v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (key === "giniWealth") return v.toFixed(3);
  if (key === "meanWealth") return v.toFixed(2);
  if (key === "top10WealthShare") return v.toFixed(3);
  if (key === "totalWealth") return v.toFixed(1);
  if (key === "innovationFlowPerAgent" || key === "innovationFlowPerMeanWealth") return v.toPrecision(6);
  return v.toPrecision(5);
}

function formatFinishedAt(ts: string): string {
  const n = Date.parse(ts);
  if (!Number.isFinite(n)) return "—";
  return new Date(n).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function OptimizationPanel(props: {
  baseConfig: SimConfig;
  mode: "heuristic" | "qre" | "llm";
  qreTemp: number;
  onLoadBestRun: (cell: GridCellResult) => void;
  /** Fires after a run segment with all trial cells collected (for saving as an optimization batch). */
  onSessionCellsFinished?: (
    cells: GridCellResult[],
    meta: { sessionId: string | null; cancelled: boolean },
  ) => void;
  onLabJobRunnerChange?: (active: boolean) => void;
  onSessionStarted?: (meta: { sessionId: string }) => void;
  /** Focus Optimize tab (e.g. from a cross-tab durable notice); optional. */
  onRequestLabTab?: () => void;
  /** Linked to analysis project for SQLite `lab_sessions.project_id` (optional). */
  persistenceProjectId?: string | null;
  activeOptimizationSession?: LabSessionHydrationSummary | null;
}) {
  const initialPolicyMode: OptimizationPolicyMode = props.mode === "qre" ? "qre" : "heuristic";
  const [selectedAxes, setSelectedAxes] = useState<Set<GridAxisId>>(() => new Set(DEFAULT_OPT_AXES));
  const [policyMode, setPolicyMode] = useState<OptimizationPolicyMode>(initialPolicyMode);
  const [metric, setMetric] = useState<OptimizationMetricKey>("innovationFlowPerAgent");
  const [objective, setObjective] = useState<OptimizationObjective>("target");
  const [targetStr, setTargetStr] = useState("0.05");
  const [populationSize, setPopulationSize] = useState(12);
  const [generations, setGenerations] = useState(15);
  const [mutationRate, setMutationRate] = useState(0.12);
  const [continueGenerations, setContinueGenerations] = useState(10);
  /** Planned evals & gen ceiling for the segment currently running (for progress UI). */
  const [segmentPlannedEvals, setSegmentPlannedEvals] = useState(12 * 15);
  const [segmentGenDisplayEnd, setSegmentGenDisplayEnd] = useState(15);
  const [segmentEvalBaseline, setSegmentEvalBaseline] = useState(0);

  const resumeBaselineEvalRef = useRef(0);
  const resumeGenBaselineRef = useRef(0);
  const lastBestGenesRef = useRef<number[] | null>(null);
  const trialCellsSessionRef = useRef<GridCellResult[]>([]);
  const leaderTrialIdPersistRef = useRef<string | null>(null);
  /** Gene vector length from last finished optimization (for resume eligibility vs axis count). */
  const [resumeGeneCount, setResumeGeneCount] = useState<number | null>(null);

  const [plannedTotalAgentsStr, setPlannedTotalAgentsStr] = useState(() =>
    String(totalAgents(props.baseConfig.agentCounts)),
  );
  const [maxAgentsInput, setMaxAgentsInput] = useState("");
  const [maxEvalBudgetInput, setMaxEvalBudgetInput] = useState(() => String(GRID_ABS_MAX_RUNS));
  /** Empty = use Run sidebar ticks (`baseConfig.ticks`). */
  const [optTicksStr, setOptTicksStr] = useState("");

  const [running, setRunning] = useState(false);
  const activeLabJobIdRef = useRef<string | null>(null);
  const lastBestRef = useRef<{
    run: GridCellResult["run"];
    assignments: GridCellResult["assignments"];
    label: string;
  } | null>(null);

  const [progress, setProgress] = useState<{
    generation: number;
    evaluations: number;
    bestRmse: number;
    bestMetric: number;
    progressObjective: OptimizationObjective;
  } | null>(null);
  const [result, setResult] = useState<{
    objective: OptimizationObjective;
    rmse: number | null;
    achieved: number | null;
    assignmentsLabel: string;
    evaluations: number;
    cancelled: boolean;
  } | null>(null);

  const [trialRows, setTrialRows] = useState<OptTrialRow[]>([]);
  const [leaderRowId, setLeaderRowId] = useState<string | null>(null);
  const [leaderCell, setLeaderCell] = useState<GridCellResult | null>(null);
  const [totalEvalCount, setTotalEvalCount] = useState(0);
  const [currentEvalLive, setCurrentEvalLive] = useState<{
    evaluationNumber: number;
    generation: number;
    shortLabel: string;
  } | null>(null);
  const [lastWallMs, setLastWallMs] = useState<number | null>(null);
  const [, labJobUiBump] = useState(0);
  const [hydratedSnapshot, setHydratedSnapshot] = useState<OptimizationProgressSnapshot | null>(null);
  const [hydratedOverviewRows, setHydratedOverviewRows] = useState<
    ReturnType<typeof deriveHydratedOptimizationOverviewRows>
  >([]);
  const [overviewSortKey, setOverviewSortKey] = useState<OptimizationOverviewSortKey>(
    () => getDefaultOptimizationOverviewSort().key,
  );
  const [overviewSortDirection, setOverviewSortDirection] = useState<OptimizationOverviewSortDirection>(
    () => getDefaultOptimizationOverviewSort().direction,
  );
  const [selectedOverviewRowId, setSelectedOverviewRowId] = useState<string | null>(null);
  const [hydratedTrialLoadingId, setHydratedTrialLoadingId] = useState<string | null>(null);
  const [lastPersistedTrialAt, setLastPersistedTrialAt] = useState<string | null>(null);
  const hydratedSnapshotRef = useRef<OptimizationProgressSnapshot | null>(null);
  const lastOverviewFetchAtMsRef = useRef<number | null>(null);
  const lastOverviewSnapshotRef = useRef<OptimizationProgressSnapshot | null>(null);
  const hydratedOverviewFetchInFlightRef = useRef(false);

  const optimizationRunStartMsRef = useRef<number | null>(null);
  const currentEvalStartMsRef = useRef<number | null>(null);
  const optimizeStartWarnedRef = useRef(false);

  const activeBackendSession =
    props.activeOptimizationSession &&
    (props.activeOptimizationSession.status === "running" || props.activeOptimizationSession.status === "queued")
      ? props.activeOptimizationSession
      : null;
  const hasHydratedRunningSession = !running && activeBackendSession?.status === "running";
  const hydratedSessionSettings = useMemo(
    () => deriveSessionOptimizationSettings(props.activeOptimizationSession?.meta),
    [props.activeOptimizationSession?.meta],
  );
  const activeMetric =
    hasHydratedRunningSession && hydratedSessionSettings.metric != null
      ? hydratedSessionSettings.metric
      : metric;
  const activeObjective =
    hasHydratedRunningSession && hydratedSessionSettings.objective != null
      ? hydratedSessionSettings.objective
      : objective;
  const activePolicyMode =
    hasHydratedRunningSession && hydratedSessionSettings.policyMode != null
      ? hydratedSessionSettings.policyMode
      : policyMode;

  useEffect(() => {
    if (!hasHydratedRunningSession) return;
    if (hydratedSessionSettings.metric != null && hydratedSessionSettings.metric !== metric) {
      setMetric(hydratedSessionSettings.metric);
    }
    if (hydratedSessionSettings.objective != null && hydratedSessionSettings.objective !== objective) {
      setObjective(hydratedSessionSettings.objective);
    }
    if (hydratedSessionSettings.policyMode != null && hydratedSessionSettings.policyMode !== policyMode) {
      setPolicyMode(hydratedSessionSettings.policyMode);
    }
    if (
      hydratedSessionSettings.objective === "target" &&
      hydratedSessionSettings.target != null &&
      Number.isFinite(hydratedSessionSettings.target)
    ) {
      const next = String(hydratedSessionSettings.target);
      if (next !== targetStr) setTargetStr(next);
    }
  }, [
    hasHydratedRunningSession,
    hydratedSessionSettings.metric,
    hydratedSessionSettings.objective,
    hydratedSessionSettings.policyMode,
    hydratedSessionSettings.target,
    metric,
    objective,
    policyMode,
    targetStr,
  ]);

  useEffect(() => {
    if (hasHydratedRunningSession || props.mode === "llm") return;
    const next: OptimizationPolicyMode = props.mode === "qre" ? "qre" : "heuristic";
    if (policyMode !== next) setPolicyMode(next);
  }, [hasHydratedRunningSession, policyMode, props.mode]);

  useEffect(() => {
    props.onLabJobRunnerChange?.(running);
  }, [running, props.onLabJobRunnerChange]);

  useEffect(() => subscribeLabJobs(() => labJobUiBump((n) => n + 1)), []);

  useEffect(() => {
    if (!hasHydratedRunningSession) {
      setHydratedSnapshot(null);
      return;
    }
    const sessionId = props.activeOptimizationSession?.id;
    if (!sessionId) return;
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/lab/sessions/${encodeURIComponent(sessionId)}/progress`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          progress?: { evaluationIndex?: number; generation?: number; trialCount?: number } | null;
        };
        const p = json.progress;
        if (!alive || !p) return;
        if (typeof p.evaluationIndex !== "number" || typeof p.generation !== "number") return;
        setHydratedSnapshot({
          evaluationIndex: p.evaluationIndex,
          generation: p.generation,
          trialCount: typeof p.trialCount === "number" ? p.trialCount : p.evaluationIndex,
        });
      } catch {
        /* keep stale snapshot on transient errors */
      }
    };
    void refresh();
    const t = window.setInterval(() => void refresh(), 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hasHydratedRunningSession, props.activeOptimizationSession?.id]);

  useEffect(() => {
    hydratedSnapshotRef.current = hydratedSnapshot;
  }, [hydratedSnapshot]);

  useEffect(() => {
    if (!hasHydratedRunningSession) {
      setHydratedOverviewRows([]);
      setLastPersistedTrialAt(null);
      lastOverviewFetchAtMsRef.current = null;
      lastOverviewSnapshotRef.current = null;
      hydratedOverviewFetchInFlightRef.current = false;
      return;
    }
    const sessionId = props.activeOptimizationSession?.id;
    if (!sessionId) return;
    let alive = true;
    const refresh = async () => {
      if (hydratedOverviewFetchInFlightRef.current) return;
      const nowMs = Date.now();
      if (
        !shouldRefreshHydratedOverview({
          snapshot: hydratedSnapshotRef.current,
          lastSnapshot: lastOverviewSnapshotRef.current,
          nowMs,
          lastFetchAtMs: lastOverviewFetchAtMsRef.current,
          maxIdleMs: 8_000,
        })
      ) {
        return;
      }
      hydratedOverviewFetchInFlightRef.current = true;
      try {
        const res = await fetch(`/api/lab/sessions/${encodeURIComponent(sessionId)}/trials`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { trials?: PersistedOptimizationTrial[] };
        if (!alive || !Array.isArray(json.trials)) return;
        const snapshotForOverview = hydratedSnapshotRef.current;
        const overview = deriveHydratedOptimizationOverviewRows({
          trials: json.trials,
          snapshot: snapshotForOverview,
          cap: MAX_OPT_TRIAL_ROWS,
        });
        const latestFinishedAt = overview[0]?.finishedAt ?? null;
        setHydratedOverviewRows(overview);
        setLastPersistedTrialAt(latestFinishedAt);
        lastOverviewFetchAtMsRef.current = nowMs;
        lastOverviewSnapshotRef.current = snapshotForOverview;
      } catch {
        /* Keep stale finished rows on transient API errors. */
      } finally {
        hydratedOverviewFetchInFlightRef.current = false;
      }
    };
    void refresh();
    const t = window.setInterval(() => void refresh(), 2500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [hasHydratedRunningSession, props.activeOptimizationSession?.id]);

  const hydratedSelectionStorageKey = useMemo(() => {
    const sessionId = props.activeOptimizationSession?.id;
    return sessionId ? `opt.preview.selection.${sessionId}` : null;
  }, [props.activeOptimizationSession?.id]);

  useEffect(() => {
    if (running) return;
    if (!hydratedSelectionStorageKey) {
      setSelectedOverviewRowId(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(hydratedSelectionStorageKey);
      if (raw && raw.length > 0) setSelectedOverviewRowId(raw);
    } catch {
      /* ignore storage read errors */
    }
  }, [hydratedSelectionStorageKey, running]);

  useEffect(() => {
    if (!running) return;
    const id = activeLabJobIdRef.current;
    if (!id) return;
    const t = window.setInterval(() => patchActiveLabJob(id, {}), LAB_JOB_HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [running]);

  const interruptedOptimizationJob = (() => {
    const j = readActiveLabJob();
    if (!j || j.status !== "running" || j.type !== "optimization") return null;
    if (j.ownerTabId !== getLabTabId()) return null;
    if (running) return null;
    return j;
  })();

  const toggleAxis = useCallback((id: GridAxisId) => {
    setSelectedAxes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const target = useMemo(() => {
    const v = Number(targetStr.replace(/,/g, ""));
    return Number.isFinite(v) ? v : NaN;
  }, [targetStr]);

  const axisIds = useMemo(() => GRID_AXIS_DEFINITIONS.map((d) => d.id).filter((id) => selectedAxes.has(id)), [selectedAxes]);

  const sidebarTotal = useMemo(() => totalAgents(props.baseConfig.agentCounts), [props.baseConfig.agentCounts]);

  const plannedGridN = useMemo(() => {
    const t = plannedTotalAgentsStr.trim();
    if (t === "") return sidebarTotal;
    const v = parseInt(t, 10);
    if (!Number.isFinite(v)) return sidebarTotal;
    return Math.max(0, v);
  }, [plannedTotalAgentsStr, sidebarTotal]);

  const maxAgentsCap = useMemo(() => {
    const t = maxAgentsInput.trim();
    if (t === "") return null;
    const v = parseInt(t, 10);
    if (!Number.isFinite(v) || v < 1) return null;
    return v;
  }, [maxAgentsInput]);

  const maxOptEvalCap = useMemo(() => {
    const v = parseInt(maxEvalBudgetInput.replace(/\s/g, ""), 10);
    if (!Number.isFinite(v)) return GRID_ABS_MAX_RUNS;
    return Math.min(GRID_ABS_MAX_RUNS, Math.max(1, v));
  }, [maxEvalBudgetInput]);

  const effectiveTicks = useMemo(() => {
    const t = optTicksStr.trim();
    if (t === "") return props.baseConfig.ticks;
    const v = parseInt(t, 10);
    if (!Number.isFinite(v)) return props.baseConfig.ticks;
    return Math.min(OPT_MAX_SIM_TICKS, Math.max(1, v));
  }, [optTicksStr, props.baseConfig.ticks]);

  const optBaseConfig = useMemo(
    (): SimConfig => ({
      ...props.baseConfig,
      ticks: effectiveTicks,
      agentCounts: hamiltonAllocateCountsFromWeights(plannedGridN, props.baseConfig.agentCounts),
    }),
    [effectiveTicks, plannedGridN, props.baseConfig],
  );

  const evalEstimate = populationSize * generations;
  const evalOverBudget = evalEstimate > maxOptEvalCap;

  const startDisabled =
    running ||
    activeBackendSession != null ||
    axisIds.length === 0 ||
    (objective === "target" && !Number.isFinite(target)) ||
    evalOverBudget ||
    plannedGridN < 1;

  const cohortTotalAgents = useMemo(() => totalAgents(optBaseConfig.agentCounts), [optBaseConfig.agentCounts]);

  const runOptimization = useCallback(
    async (sessionMode: "fresh" | "continue") => {
      if (running || axisIds.length === 0) return;
      if (objective === "target" && !Number.isFinite(target)) return;
      if (plannedGridN < 1) return;

      const gens =
        sessionMode === "continue" ? Math.max(1, Math.min(500, continueGenerations)) : generations;
      const segmentEvals = populationSize * gens;
      const continueOver =
        sessionMode === "continue" && segmentEvals > maxOptEvalCap;
      const freshOver = sessionMode === "fresh" && evalOverBudget;
      if (continueOver || freshOver) return;

      if (sessionMode === "continue") {
        const g = lastBestGenesRef.current;
        if (!g || g.length !== axisIds.length) return;
      }
      setProgress(null);
      setResult(null);
      if (sessionMode === "fresh") {
        trialCellsSessionRef.current = [];
        leaderTrialIdPersistRef.current = null;
      }

      setSegmentPlannedEvals(segmentEvals);
      if (sessionMode === "fresh") {
        resumeBaselineEvalRef.current = 0;
        resumeGenBaselineRef.current = 0;
        lastBestGenesRef.current = null;
        setResumeGeneCount(null);
        setSegmentEvalBaseline(0);
        setSegmentGenDisplayEnd(gens);
        lastBestRef.current = null;
        setTrialRows([]);
        setLeaderRowId(null);
        setLeaderCell(null);
        setTotalEvalCount(0);
      } else {
        const eg = resumeBaselineEvalRef.current;
        const gg = resumeGenBaselineRef.current;
        setSegmentEvalBaseline(eg);
        setSegmentGenDisplayEnd(gg + gens);
      }

      const jobId = newLabJobId();
      activeLabJobIdRef.current = jobId;
      props.onSessionStarted?.({ sessionId: jobId });
      await persistLabSessionCreate({
        id: jobId,
        sessionType: "optimization",
        status: "queued",
        projectId: props.persistenceProjectId ?? null,
        meta: {
          label: sessionMode === "continue" ? "Optimization · continue" : "Optimization",
          metric,
          objective,
          target: objective === "target" ? target : null,
          axisIds,
          mode: props.mode,
          policyMode: activePolicyMode,
          qreTemp: activePolicyMode === "qre" ? props.qreTemp : null,
          baseSeed: props.baseConfig.seed,
          cohortPlannedN: plannedGridN,
          ticks: effectiveTicks,
          sessionMode,
          populationSize,
          generations: gens,
          mutationRate,
          maxAgentsCap: maxAgentsCap ?? null,
          maxEvalBudget: maxOptEvalCap,
          baseConfig: optBaseConfig,
          evaluationNumberOffset: resumeBaselineEvalRef.current,
          generationDisplayOffset: resumeGenBaselineRef.current,
        },
      });
      setActiveLabJob({
        id: jobId,
        type: "optimization",
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: "running",
        label: sessionMode === "continue" ? "Optimization queued · continue segment" : "Optimization queued",
        progress: {
          evaluations: resumeBaselineEvalRef.current,
          planned: segmentEvals,
          generation: resumeGenBaselineRef.current,
        },
        ownerTabId: getLabTabId(),
        payload: { sessionMode, populationSize, generations: gens, policyMode: activePolicyMode },
      });

      setCurrentEvalLive(null);
      setLastWallMs(null);
  }, [
    axisIds,
    evalOverBudget,
    generations,
    maxAgentsCap,
    activePolicyMode,
    metric,
    mutationRate,
    objective,
    optBaseConfig,
    plannedGridN,
    populationSize,
    props.mode,
    props.qreTemp,
    target,
    continueGenerations,
    maxOptEvalCap,
    props.persistenceProjectId,
  ]);

  const loadBestRun = useCallback(() => {
    const b = lastBestRef.current;
    if (!b) return;
    props.onLoadBestRun({
      id: `opt_${Date.now()}`,
      label: b.label,
      assignments: b.assignments,
      run: b.run,
    });
  }, [props]);

  const loadTrialCell = useCallback(
    (cell: GridCellResult) => {
      props.onLoadBestRun({ ...cell, id: `${cell.id}_v_${Date.now()}` });
    },
    [props],
  );

  const loadLeaderCell = useCallback(() => {
    if (leaderCell) props.onLoadBestRun({ ...leaderCell, id: `${leaderCell.id}_lead_${Date.now()}` });
  }, [leaderCell, props]);

  const loadHydratedTrialById = useCallback(
    async (trialId: string) => {
      const sessionId = props.activeOptimizationSession?.id;
      if (!sessionId) return;
      setHydratedTrialLoadingId(trialId);
      try {
        const res = await fetch(
          `/api/lab/sessions/${encodeURIComponent(sessionId)}/trials/${encodeURIComponent(trialId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          trial?: {
            id: string;
            generation: number;
            evaluationIndex: number;
            assignments: unknown;
            fullRunJson: string | null;
          };
        };
        if (!json.trial?.fullRunJson) return;
        const run = reviveStoredSingleRun(json.trial.fullRunJson);
        const cell: GridCellResult = {
          id: `hydrated_${json.trial.id}`,
          label: `Opt · G${json.trial.generation + 1} #${json.trial.evaluationIndex}`,
          assignments: Array.isArray(json.trial.assignments)
            ? (json.trial.assignments as GridCellResult["assignments"])
            : [],
          run: run as GridCellResult["run"],
        };
        props.onLoadBestRun({ ...cell, id: `${cell.id}_v_${Date.now()}` });
        setSelectedOverviewRowId(trialId);
        if (hydratedSelectionStorageKey) {
          try {
            window.localStorage.setItem(hydratedSelectionStorageKey, trialId);
          } catch {
            /* ignore storage write errors */
          }
        }
      } catch {
        /* ignore transient load failures */
      } finally {
        setHydratedTrialLoadingId((prev) => (prev === trialId ? null : prev));
      }
    },
    [hydratedSelectionStorageKey, props],
  );

  const segmentDoneEvals = Math.max(0, totalEvalCount - segmentEvalBaseline);
  const segPlan = segmentPlannedEvals > 0 ? segmentPlannedEvals : evalEstimate;
  const runStartMs = optimizationRunStartMsRef.current;
  const liveElapsedMs = running && runStartMs != null ? Date.now() - runStartMs : null;
  const curEvalElapsedMs =
    running && currentEvalLive != null && currentEvalStartMsRef.current != null
      ? Date.now() - currentEvalStartMsRef.current
      : null;
  const progressPct = segPlan > 0 ? Math.min(100, (segmentDoneEvals / segPlan) * 100) : 0;
  const etaMs =
    running &&
    segmentDoneEvals > 0 &&
    runStartMs != null &&
    segPlan > segmentDoneEvals
      ? ((Date.now() - runStartMs) / segmentDoneEvals) * (segPlan - segmentDoneEvals)
      : null;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const startedAt = optimizationRunStartMsRef.current;
      if (startedAt == null || optimizeStartWarnedRef.current) return;
      if (totalEvalCount > segmentEvalBaseline) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < 45_000) return;
      optimizeStartWarnedRef.current = true;
      console.warn("[OptimizationPanel] Slow optimize start detected", {
        elapsedMs: elapsed,
        segmentPlannedEvals,
        segmentEvalBaseline,
        axisCount: axisIds.length,
        policyMode: activePolicyMode,
      });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [
    activePolicyMode,
    axisIds.length,
    running,
    segmentEvalBaseline,
    segmentPlannedEvals,
    totalEvalCount,
  ]);

  const continueEvalBudget = populationSize * Math.max(1, continueGenerations);
  const continueOverBudget = continueEvalBudget > maxOptEvalCap;
  const resumeMatchesAxes =
    resumeGeneCount != null && resumeGeneCount === axisIds.length && axisIds.length > 0;
  const continueDisabled =
    running ||
    activeBackendSession != null ||
    !resumeMatchesAxes ||
    continueOverBudget ||
    plannedGridN < 1 ||
    (objective === "target" && !Number.isFinite(target));

  const localHydratedProgress: LabJobOptimizationProgress | null = (() => {
    const active = readActiveLabJob();
    if (!active || active.type !== "optimization") return null;
    if (!isOptimizationProgress(active.progress)) return null;
    if (props.activeOptimizationSession?.id && active.id !== props.activeOptimizationSession.id) return null;
    return active.progress;
  })();

  const hydratedLive =
    hasHydratedRunningSession && props.activeOptimizationSession
      ? deriveHydratedOptimizationLiveProgress({
          session: props.activeOptimizationSession,
          snapshot: hydratedSnapshot,
          localProgress: localHydratedProgress,
          nowMs: Date.now(),
        })
      : null;

  const displayDoneEvals = running ? segmentDoneEvals : hydratedLive?.evaluations ?? 0;
  const displayPlan = running ? segPlan : Math.max(1, hydratedLive?.planned ?? hydratedLive?.evaluations ?? 1);
  const displayProgressPct = displayPlan > 0 ? Math.min(100, (displayDoneEvals / displayPlan) * 100) : 0;
  const displayElapsedMs = running ? liveElapsedMs : (hydratedLive?.elapsedMs ?? null);
  const displayEtaMs =
    running && etaMs != null
      ? etaMs
      : !running &&
          hydratedLive?.throughputPerSec != null &&
          hydratedLive.throughputPerSec > 0 &&
          displayPlan > displayDoneEvals
        ? ((displayPlan - displayDoneEvals) / hydratedLive.throughputPerSec) * 1000
        : null;

  const localOverviewRows = trialRows
    .slice()
    .reverse()
    .map((row) => ({
      id: row.id,
      generation: row.generation,
      evaluationNumber: row.evaluationNumber,
      metricValue: row.metricValue,
      mse: row.mse,
      rmse: Number.isFinite(Math.sqrt(Math.max(0, row.mse))) ? Math.sqrt(Math.max(0, row.mse)) : null,
      durationMs: row.durationMs,
      finishedAt: row.finishedAt,
      source: "local" as const,
      status: "finished" as const,
      isBest: row.id === leaderRowId,
      hasPreviewRun: true,
    }));
  const overviewRows = running ? localOverviewRows : hydratedOverviewRows;
  const resolvedBestOverviewRowId = useMemo(() => {
    if (running) return leaderRowId;
    return deriveBestOptimizationOverviewRowId({
      rows: overviewRows,
      objective: activeObjective,
    });
  }, [activeObjective, leaderRowId, overviewRows, running]);
  const sortedOverviewRows = sortOptimizationOverviewRows({
    rows: overviewRows,
    key: overviewSortKey,
    direction: overviewSortDirection,
  });
  useEffect(() => {
    if (!selectedOverviewRowId) return;
    if (overviewRows.some((row) => row.id === selectedOverviewRowId)) return;
    setSelectedOverviewRowId(null);
    if (hydratedSelectionStorageKey) {
      try {
        window.localStorage.removeItem(hydratedSelectionStorageKey);
      } catch {
        /* ignore storage write errors */
      }
    }
  }, [hydratedSelectionStorageKey, overviewRows, selectedOverviewRowId]);
  const derivedLastTrialAt = running ? (localOverviewRows[0]?.finishedAt ?? null) : lastPersistedTrialAt;
  const waitingDiagnostics = deriveOptimizationWaitingDiagnostics({
    running: running || !!hydratedLive,
    hasCurrentEvaluation: running && currentEvalLive != null,
    lastPersistedTrialAt: derivedLastTrialAt,
    nowMs: Date.now(),
    staleThresholdMs: 30_000,
  });

  const toggleOverviewSort = (key: OptimizationOverviewSortKey) => {
    if (overviewSortKey === key) {
      setOverviewSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setOverviewSortKey(key);
    if (key === "finishedAt" || key === "evaluation" || key === "generation") {
      setOverviewSortDirection("desc");
      return;
    }
    setOverviewSortDirection("asc");
  };

  const handleOverviewRowClick = useCallback(
    (rowId: string, source: "local" | "persisted", previewable: boolean) => {
      if (!previewable) return;
      if (source === "local") {
        const local = trialRows.find((row) => row.id === rowId);
        if (!local) return;
        if (local.previewRun) {
          loadTrialCell({
            id: local.id,
            label: `Opt · G${local.generation + 1} #${local.evaluationNumber}`,
            assignments: [],
            run: local.previewRun,
          });
          setSelectedOverviewRowId(rowId);
          return;
        }
        void loadHydratedTrialById(rowId);
        return;
      }
      void loadHydratedTrialById(rowId);
    },
    [loadHydratedTrialById, loadTrialCell, trialRows],
  );

  const trialRunsCountText = deriveOptimizationTrialRunsCountText({
    running,
    totalEvalCount,
    localWindowCount: trialRows.length,
    overviewCount: overviewRows.length,
  });
  const visibleTrialRows = deriveOptimizationVisibleTrialRows({
    rows: trialRows,
    running,
    maxLiveRows: 40,
  });

  return (
    <details className="rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] px-2.5 py-1.5 lg:px-2 lg:py-1.5" open>
      <summary className="cursor-pointer list-none text-xs font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        <span className="inline-flex flex-wrap items-center gap-1">
          Outcome optimization
          <ParamHelp text="One genetic algorithm over checked axes. This panel enqueues backend optimization sessions only; worker progress/trials hydrate from server persistence (no in-browser optimization execution path)." />
        </span>
      </summary>

      <div className="mt-1.5 space-y-1.5 border-t border-[var(--border)] pt-1.5 lg:space-y-1">
        {interruptedOptimizationJob ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/55 bg-amber-950/30 px-2.5 py-2 text-[11px] text-amber-100"
            role="status"
          >
            <div className="min-w-0 space-y-1">
              <p>
                <span className="font-medium">Previous optimization interrupted</span>
                {isOptimizationProgress(interruptedOptimizationJob.progress) ? (
                  <span className="text-amber-100/85">
                    {" "}
                    · last progress {interruptedOptimizationJob.progress.evaluations.toLocaleString("en-US")} /{" "}
                    {interruptedOptimizationJob.progress.planned.toLocaleString("en-US")} evals
                    {interruptedOptimizationJob.progress.generation != null
                      ? ` · gen ${interruptedOptimizationJob.progress.generation + 1}`
                      : ""}
                  </span>
                ) : null}
              </p>
              <p className="text-[10px] leading-snug text-amber-100/75">
                {resumeMatchesAxes
                  ? "Resume genes still match this session’s axes — you can use “Continue for N gens…” without auto-starting. Refresh clears trial rows; only continue if you still have a leader in memory."
                  : "Reload cleared trial memory and gene vectors. Start a fresh run or load trials from a saved project batch if you need prior work."}
              </p>
            </div>
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {props.onRequestLabTab ? (
                <button
                  type="button"
                  className="rounded border border-amber-800/60 px-2 py-0.5 text-[10px] text-amber-50 hover:bg-amber-950/50"
                  onClick={() => props.onRequestLabTab?.()}
                >
                  Focus Optimize tab
                </button>
              ) : null}
              <button
                type="button"
                className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800/80"
                onClick={() => clearActiveLabJob()}
              >
                Dismiss
              </button>
            </span>
          </div>
        ) : null}

        <section
          className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-2 py-1.5"
          aria-label="Optimization cohort and run length"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Cohort &amp; duration</div>
          <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex min-w-[8.5rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-0.5">
                Planned total N (cohort)
                <ParamHelp text="Integer headcount for the initial population in every optimization trial, from your Run mix via Hamilton (largest remainder), same as the parameter grid. Overrides the Run sidebar total for these trials only." />
              </span>
              <input
                type="number"
                min={0}
                step={1}
                className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] text-[var(--text)]"
                value={plannedTotalAgentsStr}
                onChange={(e) => setPlannedTotalAgentsStr(e.target.value)}
              />
            </label>
            <span className="inline-flex items-end gap-0.5">
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
                onClick={() => setPlannedTotalAgentsStr(String(sidebarTotal))}
              >
                Sync from run
              </button>
              <ParamHelp text="Set planned N to the current Run sidebar cohort size." />
            </span>
            <label className="flex min-w-[7.5rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-0.5">
                Simulation ticks
                <ParamHelp text="How many world ticks each trial runs. Empty field uses the Run sidebar “Simulation ticks” value. Capped for safety." />
              </span>
              <input
                type="number"
                min={1}
                max={OPT_MAX_SIM_TICKS}
                placeholder={String(props.baseConfig.ticks)}
                className="w-full max-w-[7rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] text-[var(--text)] placeholder:text-zinc-600"
                value={optTicksStr}
                onChange={(e) => setOptTicksStr(e.target.value)}
              />
            </label>
            <span className="inline-flex items-end gap-0.5">
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
                onClick={() => setOptTicksStr("")}
              >
                Use sidebar ticks
              </button>
              <ParamHelp text={`Clear override — trials use Run sidebar ticks (${props.baseConfig.ticks}).`} />
            </span>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="flex min-w-[8rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-0.5">
                Max eval budget
                <ParamHelp text={`Upper bound on population × generations (planned simulation count). Same absolute ceiling as grid max runs (${GRID_ABS_MAX_RUNS.toLocaleString(
                  "en-US",
                )}). Lower this to keep optimization tractable in the browser.`} />
              </span>
              <input
                type="number"
                min={1}
                max={GRID_ABS_MAX_RUNS}
                className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] text-[var(--text)]"
                value={maxEvalBudgetInput}
                onChange={(e) => setMaxEvalBudgetInput(e.target.value)}
              />
            </label>
            <label className="flex min-w-[8rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-0.5">
                Max agents N (optional)
                <ParamHelp text="If set, trials whose cohort Σ counts exceed this after axis patches are penalized (skipped); spawn.maxAgents is clamped like the grid batch." />
              </span>
              <input
                type="number"
                min={1}
                placeholder="no cap"
                className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] text-[var(--text)] placeholder:text-zinc-600"
                value={maxAgentsInput}
                onChange={(e) => setMaxAgentsInput(e.target.value)}
              />
            </label>
          </div>
          <p className="font-mono-n text-[10px] text-[var(--muted)]">
            Effective cohort Σ agents: {cohortTotalAgents.toLocaleString("en-US")}
            {plannedGridN !== cohortTotalAgents ? " (axis patches may change N per trial)" : ""} · ticks per trial:{" "}
            {effectiveTicks.toLocaleString("en-US")}
            {optTicksStr.trim() === "" ? " (from Run sidebar)" : ""}
          </p>
        </section>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-medium text-[var(--muted)]">Optimize axes</div>
            <span className="flex flex-wrap gap-1">
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
                onClick={() => setSelectedAxes(new Set(GRID_AXIS_DEFINITIONS.map((d) => d.id)))}
              >
                Select all axes
              </button>
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] hover:bg-[#1a1a1f] hover:text-[var(--text)]"
                onClick={() => setSelectedAxes(new Set())}
              >
                Clear all
              </button>
            </span>
          </div>
          <div className="max-h-28 overflow-y-auto text-[11px] lg:max-h-32">
            <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {GRID_AXIS_DEFINITIONS.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedAxes.has(d.id)}
                  onChange={() => toggleAxis(d.id)}
                  className="rounded border-[var(--border)]"
                />
                <span className="truncate" title={d.label}>
                  {d.short}
                </span>
              </label>
            ))}
            </div>
          </div>
        </div>

        <div className="grid gap-1.5 md:grid-cols-3">
          <label className="block text-[10px] text-[var(--muted)] md:col-span-1">
            Policy mode
            <select
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-[11px]"
              value={policyMode}
              onChange={(e) => setPolicyMode(e.target.value as OptimizationPolicyMode)}
            >
              <option value="heuristic">Heuristic (fast)</option>
              <option value="qre">QRE / softmax (fast)</option>
            </select>
          </label>
          <label className="block text-[10px] text-[var(--muted)] md:col-span-1">
            Target metric
            <select
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-[11px]"
              value={metric}
              onChange={(e) => setMetric(e.target.value as OptimizationMetricKey)}
            >
              {(Object.keys(OPTIMIZATION_METRIC_LABELS) as OptimizationMetricKey[]).map((k) => (
                <option key={k} value={k}>
                  {OPTIMIZATION_METRIC_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-1 border-0 p-0 md:col-span-1">
            <legend className="text-[10px] text-[var(--muted)]">Objective</legend>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="opt-objective"
                  checked={objective === "target"}
                  onChange={() => setObjective("target")}
                  className="rounded-full border-[var(--border)]"
                />
                Match target
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="opt-objective"
                  checked={objective === "maximize"}
                  onChange={() => setObjective("maximize")}
                  className="rounded-full border-[var(--border)]"
                />
                Maximize
              </label>
            </div>
          </fieldset>

          <label className={`block text-[10px] text-[var(--muted)] md:col-span-1 ${objective !== "target" ? "opacity-50" : ""}`}>
            Target value
            <input
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] disabled:cursor-not-allowed"
              value={targetStr}
              onChange={(e) => setTargetStr(e.target.value)}
              disabled={objective !== "target"}
              aria-disabled={objective !== "target"}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
          <label className="text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              GA population
              <ParamHelp text="Genetic algorithm population size (number of parameter vectors per generation). Product with generations must not exceed max eval budget." />
            </span>
            <input
              type="number"
              min={4}
              max={OPT_GA_MAX_POPULATION}
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-1 py-0.5 font-mono-n text-[11px]"
              value={populationSize}
              onChange={(e) =>
                setPopulationSize(
                  Math.max(4, Math.min(OPT_GA_MAX_POPULATION, parseInt(e.target.value, 10) || 4)),
                )
              }
            />
          </label>
          <label className="text-[10px] text-[var(--muted)]">
            Generations
            <input
              type="number"
              min={1}
              max={500}
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-1 py-0.5 font-mono-n text-[11px]"
              value={generations}
              onChange={(e) => setGenerations(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
            />
          </label>
          <label className="text-[10px] text-[var(--muted)]">
            Mutation
            <input
              type="number"
              min={0.02}
              max={0.5}
              step={0.02}
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-1 py-0.5 font-mono-n text-[11px]"
              value={mutationRate}
              onChange={(e) => setMutationRate(Number(e.target.value) || 0.12)}
            />
          </label>
        </div>

        <p className={`text-[10px] ${evalOverBudget ? "text-amber-100/95" : "text-[var(--muted)]"}`}>
          Planned evaluations: {evalEstimate.toLocaleString("en-US")} (GA population × generations). Budget cap:{" "}
          {maxOptEvalCap.toLocaleString("en-US")} (absolute max {GRID_ABS_MAX_RUNS.toLocaleString("en-US")}).
          {evalOverBudget ? " Lower population or generations, or raise the budget field." : ""}
        </p>

        <section className="space-y-1 rounded border border-[var(--border)] bg-[#0c0c10] px-2 py-1.5 text-[10px]">
          <div className="font-semibold uppercase tracking-wide text-[var(--muted)]">Execution path</div>
          <p className="text-[var(--muted)]">
            Optimization runs are backend-only. This tab enqueues one optimization session into the worker queue and
            streams persisted progress/trials from the server.
          </p>
        </section>

        <div className="rounded border border-[var(--border)] border-dashed bg-[#0c0c10] px-2 py-1.5">
          <div className="relative z-30 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={startDisabled}
              aria-busy={running}
              onClick={() => void runOptimization("fresh")}
              className="rounded-md bg-emerald-900/60 px-3 py-1 text-xs font-medium text-emerald-100 hover:bg-emerald-800/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-1.5">
                {running ? (
                  <span
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                    aria-hidden="true"
                  />
                ) : null}
                <span>{running ? "Optimizing…" : "Run optimization"}</span>
              </span>
            </button>
            <button
              type="button"
              disabled={!activeBackendSession}
              title="Cancel queued/running backend optimization session."
              onClick={() => {
                const sessionId = activeBackendSession?.id ?? activeLabJobIdRef.current;
                if (!sessionId) return;
                void fetch(`/api/lab/sessions/${encodeURIComponent(sessionId)}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "cancel" }),
                }).finally(() => {
                  clearActiveLabJobIfId(sessionId);
                });
              }}
              className="pointer-events-auto rounded-md border border-red-900/50 bg-red-950/40 px-3 py-1 text-xs text-red-100 hover:bg-red-950/70 disabled:opacity-40"
            >
              Stop
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              Continue for (generations)
              <ParamHelp text="Runs another segment of the genetic search starting from the best gene vector from your last completed optimization (same metric, cohort, and axes). Evaluation # and generation # continue from where you left off. Change optimized axes or cohort between runs only if you accept that stored genes may no longer match." />
            </span>
            <input
              type="number"
              min={1}
              max={500}
              className="mt-0.5 w-20 rounded border border-[var(--border)] bg-[#0d0d0f] px-1 py-0.5 font-mono-n text-[11px]"
              value={continueGenerations}
              onChange={(e) =>
                setContinueGenerations(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))
              }
            />
            </label>
            <button
              type="button"
              disabled={continueDisabled}
              onClick={() => void runOptimization("continue")}
              className="rounded-md border border-amber-800/60 bg-amber-950/50 px-3 py-1 text-xs font-medium text-amber-100 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue optimization
            </button>
            {!resumeMatchesAxes && resumeGeneCount != null ? (
              <span className="text-[10px] text-amber-100/85">
                Resume genes ({resumeGeneCount} dims) don&apos;t match selected axes ({axisIds.length}). Run a fresh search
                or restore axes.
              </span>
            ) : null}
            {continueOverBudget ? (
              <span className="text-[10px] text-amber-100/85">
                Continue segment ({continueEvalBudget.toLocaleString("en-US")} evals) exceeds max eval budget.
              </span>
            ) : null}
          </div>
        </div>

        {running || hydratedLive ? (
          <div
            className="space-y-1.5 rounded-lg border border-sky-900/40 bg-[#0a1018] px-2 py-1.5 font-mono-n text-[10px]"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-sky-100/95">Live progress</span>
              <span className="rounded border border-sky-900/45 bg-sky-950/35 px-1.5 py-0.5 text-[10px] text-sky-100/90">
                policy: {activePolicyMode === "qre" ? "QRE / softmax" : "Heuristic"}
              </span>
              <ParamHelp text="Trials execute in the backend worker process and persist into lab session storage. This panel displays server-side progress snapshots and completed trial rows." />
            </div>
            <p className="leading-snug text-[var(--muted)]">
              {running && currentEvalLive ? (
                <>
                  <span className="text-[var(--text)]">Now simulating</span> · Gen {currentEvalLive.generation + 1} · eval{" "}
                  <span className="tabular-nums text-sky-200/95">
                    {currentEvalLive.evaluationNumber}/{displayPlan.toLocaleString("en-US")}
                  </span>
                  <span className="text-[var(--border)]"> · </span>
                  <span className="break-words text-[11px] text-[var(--text)]">{currentEvalLive.shortLabel}</span>
                </>
              ) : hydratedLive ? (
                <>
                  <span className="text-[var(--text)]">Resumed live session</span>
                  {hydratedLive.generation != null ? <> · Gen {hydratedLive.generation + 1}</> : null}
                  {" · "}
                  eval{" "}
                  <span className="tabular-nums text-sky-200/95">
                    {hydratedLive.evaluations.toLocaleString("en-US")}/{displayPlan.toLocaleString("en-US")}
                  </span>
                  <span className="text-[var(--border)]"> · </span>
                  <span className="text-[11px] text-[var(--text)]">{waitingDiagnostics.message}</span>
                </>
              ) : (
                <span className="text-[var(--muted)]">Preparing next evaluation…</span>
              )}
            </p>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
                <span>Segment evaluations</span>
                <span className="tabular-nums text-[var(--text)]">
                  {displayDoneEvals.toLocaleString("en-US")} / {displayPlan.toLocaleString("en-US")}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={displayPlan}
                aria-valuenow={Math.min(displayDoneEvals, displayPlan)}
                aria-label={`Optimization segment progress, ${displayDoneEvals} of ${displayPlan} evaluations complete`}
                className="h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-[#1a1a1f]"
              >
                <div
                  className="h-full min-w-0 rounded-full bg-emerald-700/80 transition-[width] duration-300 ease-out"
                  style={{ width: `${displayProgressPct}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--muted)]">
                <span>
                  Throughput:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {displayDoneEvals.toLocaleString("en-US")}/{displayPlan.toLocaleString("en-US")}
                  </span>{" "}
                  ({displayProgressPct.toFixed(1)}%)
                  {!running && hydratedLive?.throughputPerSec != null
                    ? ` · ${hydratedLive.throughputPerSec.toFixed(2)} eval/s`
                    : ""}
                </span>
                <span>
                  Elapsed:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {displayElapsedMs != null ? formatMsClock(displayElapsedMs) : "—"}
                  </span>
                </span>
                {displayEtaMs != null && Number.isFinite(displayEtaMs) ? (
                  <span title="Average duration × remaining evaluations">
                    ETA: <span className="tabular-nums text-[var(--text)]">~{formatMsClock(displayEtaMs)}</span>
                  </span>
                ) : (running || hydratedLive) && displayDoneEvals === 0 ? (
                  <span className="text-[var(--muted)]">ETA: …</span>
                ) : null}
                {curEvalElapsedMs != null ? (
                  <span>
                    This eval:{" "}
                    <span className="tabular-nums text-amber-100/90">{formatMsClock(curEvalElapsedMs)}</span>
                  </span>
                ) : null}
                <span>
                  Last persisted trial:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {waitingDiagnostics.lastPersistedTrialAt ? formatFinishedAt(waitingDiagnostics.lastPersistedTrialAt) : "—"}
                  </span>
                </span>
                <span>
                  Since last write:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {waitingDiagnostics.sinceLastTrialWriteMs != null
                      ? formatMsClock(waitingDiagnostics.sinceLastTrialWriteMs)
                      : "—"}
                  </span>
                </span>
                <span>
                  State:{" "}
                  <span className="text-[var(--text)]">
                    {waitingDiagnostics.phase === "evaluating"
                      ? "evaluating"
                      : waitingDiagnostics.phase === "waiting_to_persist"
                        ? "waiting to persist"
                        : "idle"}
                  </span>
                </span>
              </div>
              {waitingDiagnostics.showLongWaitNote ? (
                <p className="text-[10px] leading-snug text-sky-100/80">
                  No new trial persisted for more than 30s. This is often expected while a long simulation tick or heavy candidate
                  evaluation is still running.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {running && progress ? (
          <p className="font-mono-n text-[10px] text-[var(--muted)]">
            Gen {progress.generation + 1}/{segmentGenDisplayEnd} · evals {progress.evaluations.toLocaleString("en-US")} · gen-best{" "}
            {progress.progressObjective === "target" ? (
              <>RMSE {progress.bestRmse.toPrecision(4)}</>
            ) : (
              <>metric {progress.bestMetric.toPrecision(6)}</>
            )}
          </p>
        ) : hydratedLive?.generation != null ? (
          <p className="font-mono-n text-[10px] text-[var(--muted)]">
            Gen {hydratedLive.generation + 1}
            {hydratedLive.planned != null ? ` · evals ${hydratedLive.evaluations.toLocaleString("en-US")} / ${hydratedLive.planned.toLocaleString("en-US")}` : ` · evals ${hydratedLive.evaluations.toLocaleString("en-US")}`}{" "}
            · live snapshot
          </p>
        ) : null}

        {result ? (
          <div className="space-y-1 rounded border border-[var(--border)] bg-[#0c0c10] p-1.5 text-[11px]">
            <div className="text-[10px] text-[var(--muted)]">
              {result.cancelled ? "Stopped early · " : ""}
              {result.objective === "target" && result.rmse != null ? (
                <>
                  Best RMSE {result.rmse.toPrecision(4)}
                  {result.achieved != null ? (
                    <>
                      {" "}
                      · metric ≈ {result.achieved.toPrecision(6)} (target {targetStr})
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {result.achieved != null ? (
                    <>
                      Best metric {result.achieved.toPrecision(6)} (maximize)
                    </>
                  ) : (
                    "No valid metric on best run"
                  )}
                </>
              )}
            </div>
            <div className="break-words text-[var(--text)]">{result.assignmentsLabel}</div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--muted)]">
              <span>{result.evaluations.toLocaleString("en-US")} evaluations</span>
              {lastWallMs != null ? (
                <span title="Wall-clock time for the full optimization job (including all sequential simulations)">
                  · Wall time {formatMsClock(lastWallMs)}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadBestRun}
              className="mt-1 rounded border border-[var(--accent)] px-2 py-1 text-[11px] text-[var(--accent)] hover:bg-emerald-950/30"
            >
              Load best run into viewer
            </button>
          </div>
        ) : null}

        {(running || trialRows.length > 0 || leaderCell || sortedOverviewRows.length > 0) && (
          <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              <span className="font-semibold text-[var(--text)]">Trial runs</span>
              <ParamHelp text="One row per finished simulation evaluation (same as grid batch cells). ★ marks the current genetic-algorithm leader on your objective metric. Click a label or Load to replay that run in the main viewer (network, metrics, timeline)." />
              <span className="tabular-nums text-[var(--muted)]">
                {trialRunsCountText}
              </span>
            </div>

            {leaderCell ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-900/40 bg-emerald-950/25 px-2 py-1.5 font-mono-n text-[10px]">
                <span className="font-medium text-emerald-100/95">Current leader</span>
                <span className="text-[var(--muted)]">{OPTIMIZATION_METRIC_LABELS[activeMetric]}:</span>
                <span className="tabular-nums text-[var(--text)]">
                  {formatOptimizationMetricCell(
                    activeMetric,
                    leaderCell.run.history[leaderCell.run.history.length - 1]
                      ? readOptimizationMetric(leaderCell.run.history[leaderCell.run.history.length - 1]!, activeMetric)
                      : null,
                  )}
                </span>
                <button
                  type="button"
                  onClick={loadLeaderCell}
                  className="rounded border border-emerald-700/60 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-900/40"
                >
                  Load leader → viewer
                </button>
              </div>
            ) : null}

            {sortedOverviewRows.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold text-[var(--text)]">Finished runs overview</div>
                <div className="max-h-[min(40vh,360px)] overflow-auto rounded border border-[var(--border)]">
                  <table className="w-max min-w-full border-collapse text-left font-mono-n text-[10px]">
                    <thead className="sticky top-0 z-[5] bg-[#141418] text-[var(--muted)] shadow-[0_1px_0_rgba(0,0,0,0.35)]">
                      <tr className="border-b border-[var(--border)]">
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("generation")}>
                            Gen{overviewSortKey === "generation" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("evaluation")}>
                            Eval{overviewSortKey === "evaluation" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                        <th className="p-1.5 text-center" title="Best/leader trial">
                          ★
                        </th>
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("metric")}>
                            {activeMetric === "innovationFlowPerMeanWealth"
                              ? "I/W̄"
                              : OPTIMIZATION_METRIC_LABELS[activeMetric].slice(0, 12)}
                            {overviewSortKey === "metric" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("rmse")}>
                            RMSE{overviewSortKey === "rmse" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                        <th className="p-1.5 text-left">Status</th>
                        <th className="p-1.5 text-left">Preview</th>
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("duration")}>
                            Duration{overviewSortKey === "duration" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                        <th className="p-1.5 text-right">
                          <button type="button" className="hover:text-[var(--text)]" onClick={() => toggleOverviewSort("finishedAt")}>
                            Finished{overviewSortKey === "finishedAt" ? (overviewSortDirection === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedOverviewRows.map((row) => {
                        const previewable = isOptimizationOverviewRowPreviewable(row);
                        const isBest = isOptimizationOverviewRowBest(row, resolvedBestOverviewRowId);
                        return (
                        <tr
                          key={`overview_${row.id}`}
                          className={`border-t border-[var(--border)] ${
                            selectedOverviewRowId === row.id ? "bg-emerald-950/25" : "hover:bg-[#1a1a1f]"
                          } ${previewable ? "cursor-pointer" : "opacity-70"}`}
                          onClick={() => handleOverviewRowClick(row.id, row.source, previewable)}
                        >
                          <td className="p-1.5 text-right tabular-nums">{row.generation != null ? row.generation + 1 : "—"}</td>
                          <td className="p-1.5 text-right tabular-nums">{row.evaluationNumber != null ? row.evaluationNumber : "—"}</td>
                          <td className="p-1.5 text-center text-amber-200/90">{isBest ? "★" : ""}</td>
                          <td className="p-1.5 text-right tabular-nums">{formatOptimizationMetricCell(activeMetric, row.metricValue)}</td>
                          <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                            {row.rmse != null ? row.rmse.toPrecision(4) : "—"}
                          </td>
                          <td className="p-1.5 text-[var(--accent)]">{row.status}</td>
                          <td className="p-1.5 text-[var(--muted)]">
                            {hydratedTrialLoadingId === row.id ? "Loading…" : previewable ? "Click row" : "Unavailable"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                            {formatOptimizationDurationMs(row.durationMs)}
                          </td>
                          <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                            {row.finishedAt ? formatFinishedAt(row.finishedAt) : "—"}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {visibleTrialRows.length > 0 ? (
              <div className="max-h-[min(62vh,560px)] overflow-auto rounded border border-[var(--border)]">
                <table className="w-max min-w-full border-collapse text-left font-mono-n text-[10px]">
                  <thead className="sticky top-0 z-[5] bg-[#141418] text-[var(--muted)] shadow-[0_1px_0_rgba(0,0,0,0.35)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="sticky left-0 z-[6] bg-[#141418] p-1.5 text-right shadow-[1px_0_0_var(--border)]">#</th>
                      <th className="p-1.5 text-right">Gen</th>
                      <th className="p-1.5 text-right">Eval</th>
                      <th className="p-1.5 text-center" title="Genetic algorithm leader">
                        ★
                      </th>
                      <th className="min-w-[5rem] p-1.5 text-right" title={OPTIMIZATION_METRIC_LABELS[activeMetric]}>
                        {activeMetric === "innovationFlowPerMeanWealth"
                          ? "I/W̄"
                          : OPTIMIZATION_METRIC_LABELS[activeMetric].slice(0, 12)}
                      </th>
                      {activeObjective === "target" ? (
                        <th className="p-1.5 text-right" title="Root mean squared error vs target">
                          RMSE
                        </th>
                      ) : null}
                      <th className="p-1.5 text-right" title="Gini coefficient of wealth, final tick">
                        Gini
                      </th>
                      <th className="p-1.5 text-right" title="Mean wealth per agent">
                        W/agent
                      </th>
                      <th className="p-1.5 text-right" title="Innovation flow ÷ agent">
                        I/agent
                      </th>
                      <th className="p-1.5 text-right" title="Wall time for this simulation">
                        Time
                      </th>
                      <th className="min-w-[8rem] p-1.5">Label / load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTrialRows.map((row, idx) => {
                      const isLeader = row.id === leaderRowId;
                      const rmse = objective === "target" ? Math.sqrt(Math.max(0, row.mse)) : NaN;
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-[var(--border)] ${
                            isLeader ? "bg-emerald-950/20" : "hover:bg-[#1a1a1f]"
                          }`}
                        >
                          <td
                            className={`sticky left-0 z-[1] p-1.5 text-right text-[var(--muted)] shadow-[1px_0_0_var(--border)] ${
                              isLeader ? "bg-emerald-950/30" : "bg-[#0a0a0c]"
                            }`}
                          >
                            {idx + 1 + Math.max(0, trialRows.length - visibleTrialRows.length)}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">{row.generation + 1}</td>
                          <td className="p-1.5 text-right tabular-nums">{row.evaluationNumber}</td>
                          <td className="p-1.5 text-center text-amber-200/90">{isLeader ? "★" : ""}</td>
                          <td className="p-1.5 text-right tabular-nums">
                            {formatOptimizationMetricCell(activeMetric, row.metricValue)}
                          </td>
                          {activeObjective === "target" ? (
                            <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                              {Number.isFinite(rmse) ? rmse.toPrecision(4) : "—"}
                            </td>
                          ) : null}
                          <td className="p-1.5 text-right tabular-nums">
                            {row.giniWealth != null && Number.isFinite(row.giniWealth) ? row.giniWealth.toFixed(3) : "—"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">
                            {row.meanWealth != null && Number.isFinite(row.meanWealth) ? row.meanWealth.toFixed(2) : "—"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">
                            {row.innovationPerAgent != null && Number.isFinite(row.innovationPerAgent)
                              ? row.innovationPerAgent.toFixed(6)
                              : "—"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                            {row.durationMs != null ? formatMsClock(row.durationMs) : "—"}
                          </td>
                          <td className="max-w-[14rem] p-1.5">
                            <button
                              type="button"
                              className="max-w-full truncate text-left text-[var(--accent)] hover:underline"
                              title={row.label}
                              onClick={() => {
                                if (row.previewRun) {
                                  loadTrialCell({
                                    id: row.id,
                                    label: `Opt · ${row.label}`,
                                    assignments: [],
                                    run: row.previewRun,
                                  });
                                  return;
                                }
                                void loadHydratedTrialById(row.id);
                              }}
                            >
                              {row.label}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : running ? (
              <p className="text-[10px] text-[var(--muted)]">Evaluations appear here as they finish…</p>
            ) : null}
            {running && trialRows.length > visibleTrialRows.length ? (
              <p className="text-[10px] text-[var(--muted)]">
                Rendering last {visibleTrialRows.length.toLocaleString("en-US")} rows live to keep UI responsive.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}
