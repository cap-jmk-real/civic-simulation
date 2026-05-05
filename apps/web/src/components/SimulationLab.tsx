"use client";

import {
  buildObservation,
  defaultSimConfig,
  qrePolicy,
  runSimulationAsync,
  runSimulationSync,
  serializeRun,
  stockDistribution,
  validateAction,
  type Action,
  type AgentState,
  type SimConfig,
  type SimulationRun,
  type TickRecord,
  type WorldState,
} from "@ip-sim/core";
import { runSimulationHeuristicWasm } from "@/lib/rustHeuristicRun";
import { formatMachineHintsOneLine } from "@/lib/machineResourceHints";
import { useMachineResourceHints } from "@/lib/useMachineResourceHints";
import { FieldLabel, ParamHelp } from "@/components/ParamHelp";
import { encodeReplayGif, encodeReplayWebm } from "@/lib/replayEncoder";
import {
  countsToPctTenths,
  freshPopulationPctDirty,
  pctTenthsToAgentCounts,
  percentageToTenths,
  rebalancePctTenthsAfterFieldEdit,
  tenthsToPercentage,
  type PopulationPctDirty,
  type PopulationPctTenths,
} from "@/lib/percentPopulation";
import { totalAgents } from "@/lib/populationPresets";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import { mergeAgentsWithTickSnapshot } from "@/lib/mergeAgentsAtTick";
import type { GridConstructionMode } from "@/lib/gridAxes";
import {
  addBatchToProject,
  createFolder,
  createPendingBatch,
  createProject,
  ensureAutoSubfolder,
  gridResultsToBatch,
  listProjects,
  reviveStoredSingleRun,
  singleRunToBatch,
  upsertProject,
} from "@/lib/analysisStorage";
import type { AnalysisBatch } from "@/lib/analysisTypes";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BatchGridPanel, type GridCellResult } from "./BatchGridPanel";
import { LabJobBanner } from "./LabJobBanner";
import { SimQueuePanel } from "./SimQueuePanel";
import { OptimizationPanel } from "./OptimizationPanel";
import { ProjectSidebar } from "./ProjectSidebar";
import { ForceGraph } from "./ForceGraph";
import { GraphEvolutionExport } from "./GraphEvolutionExport";
import { GraphLegend } from "./GraphLegend";
import { MetricsCharts } from "./MetricsCharts";
import { ReplayToolbar } from "./ReplayToolbar";
import {
  parseSimJobDetailResponse,
  parseSimJobsListResponse,
  type SimJobSummaryDto,
} from "@/lib/simQueue/parseJobsResponse";
import { parseQueueLabStreamPayload } from "@/lib/simQueue/parseStreamEvent";
import {
  deriveActiveRunHydrationState,
  type LabSessionHydrationSummary,
} from "@/lib/simQueue/activeRunHydration";
import {
  attachSimJobResultToBatch,
  shouldFetchSimJobDetailOnSelection,
  simJobDetailPath,
} from "@/lib/simQueue/jobProjectLinkage";
import { queuePollingIntervalMs } from "@/lib/simQueue/pollingCadence";
import { isLabInteractionActive, shouldClearStaleOverlay } from "@/lib/overlayLockGuard";

type PolicyMode = "heuristic" | "qre" | "llm";
type LabTab = "single" | "grid" | "optimize" | "queue";

type SidebarRunStatus = "running" | "done" | "failed" | "cancelled";

function mapLabSessionStatus(status: string): SidebarRunStatus {
  if (status === "running" || status === "queued") return "running";
  if (status === "cancelled") return "cancelled";
  return "done";
}

function mapSimJobStatus(status: string): SidebarRunStatus {
  if (status === "queued" || status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "done";
}

type LabSessionsListResponse = {
  sessions?: Array<{
    id?: string;
    sessionType?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    trialCount?: number;
    cellCount?: number;
    meta?: unknown;
  }>;
  error?: string;
};

function normalizeLabSessionsForHydration(json: unknown): LabSessionHydrationSummary[] {
  if (json == null || typeof json !== "object") return [];
  const o = json as LabSessionsListResponse;
  if (!Array.isArray(o.sessions)) return [];
  return o.sessions
    .map((s): LabSessionHydrationSummary | null => {
      if (
        !s ||
        typeof s.id !== "string" ||
        typeof s.sessionType !== "string" ||
        typeof s.status !== "string" ||
        typeof s.updatedAt !== "string"
      ) {
        return null;
      }
      return {
        id: s.id,
        sessionType: s.sessionType,
        status: s.status,
        createdAt: typeof s.createdAt === "string" ? s.createdAt : undefined,
        updatedAt: s.updatedAt,
        trialCount: typeof s.trialCount === "number" ? s.trialCount : 0,
        cellCount: typeof s.cellCount === "number" ? s.cellCount : 0,
        meta: s.meta,
      };
    })
    .filter((s): s is LabSessionHydrationSummary => s != null);
}

function sessionProgressText(session: LabSessionHydrationSummary): string {
  if (session.sessionType === "optimization") {
    const m = (session.meta ?? {}) as { populationSize?: unknown; generations?: unknown };
    const pop = typeof m.populationSize === "number" ? m.populationSize : null;
    const gens = typeof m.generations === "number" ? m.generations : null;
    const planned = pop != null && gens != null ? pop * gens : null;
    if (planned != null && planned > 0) {
      return `${session.trialCount.toLocaleString("en-US")} / ${planned.toLocaleString("en-US")} trials`;
    }
    return `${session.trialCount.toLocaleString("en-US")} trial(s) recorded`;
  }
  const gm = (session.meta ?? {}) as { runnableTotal?: unknown; plannedTotalRuns?: unknown };
  const planned = typeof gm.runnableTotal === "number" ? gm.runnableTotal : typeof gm.plannedTotalRuns === "number" ? gm.plannedTotalRuns : null;
  if (planned != null && planned > 0) {
    return `${session.cellCount.toLocaleString("en-US")} / ${planned.toLocaleString("en-US")} cells`;
  }
  return `${session.cellCount.toLocaleString("en-US")} cell(s) recorded`;
}

function repFromSnapshots(h: TickRecord) {
  const vals = h.agentSnapshots.map((a) => a.reputation ?? 0);
  return stockDistribution(vals);
}

function reputationStockTotal(h: TickRecord): number {
  const v = (h.metrics as { totalReputation?: number }).totalReputation;
  if (v != null && Number.isFinite(v)) return v;
  return repFromSnapshots(h).total;
}

function reputationTop10(h: TickRecord): number {
  const v = (h.metrics as { top10Reputation?: number }).top10Reputation;
  if (v != null && Number.isFinite(v)) return v;
  return repFromSnapshots(h).top10Sum;
}

function reputationTop1(h: TickRecord): number {
  const v = (h.metrics as { top1PercentReputation?: number }).top1PercentReputation;
  if (v != null && Number.isFinite(v)) return v;
  return repFromSnapshots(h).top1Sum;
}

function reputationGini(h: TickRecord): number {
  const v = (h.metrics as { giniReputation?: number }).giniReputation;
  if (v != null && Number.isFinite(v)) return v;
  return repFromSnapshots(h).gini;
}

function reputationTop10Share(h: TickRecord): number {
  const v = (h.metrics as { top10ReputationShare?: number }).top10ReputationShare;
  if (v != null && Number.isFinite(v)) return v;
  return repFromSnapshots(h).top10Share;
}

const SIM_LAB_INITIAL = (() => {
  const config = defaultSimConfig();
  return {
    config,
    populationPlannedTotal: totalAgents(config.agentCounts),
    populationPctTenths: countsToPctTenths(config.agentCounts),
  };
})();

export function SimulationLab() {
  const [config, setConfig] = useState<SimConfig>(() => SIM_LAB_INITIAL.config);
  const [populationPlannedTotal, setPopulationPlannedTotal] = useState(
    () => SIM_LAB_INITIAL.populationPlannedTotal,
  );
  const [populationPctTenths, setPopulationPctTenths] = useState<PopulationPctTenths>(
    () => SIM_LAB_INITIAL.populationPctTenths,
  );
  const [populationPctDirty, setPopulationPctDirty] = useState<PopulationPctDirty>(
    () => freshPopulationPctDirty(),
  );
  const [mode, setMode] = useState<PolicyMode>("qre");
  const [qreTemp, setQreTemp] = useState(0.65);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<(SimulationRun & { finalWorld?: WorldState }) | null>(
    null,
  );
  const [compareRun, setCompareRun] = useState<SimulationRun | null>(null);
  const [tickIndex, setTickIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackTps, setPlaybackTps] = useState(4);
  const [exportingVideo, setExportingVideo] = useState(false);
  const [exportingGif, setExportingGif] = useState(false);
  const [compiledKernel, setCompiledKernel] = useState<string | null | undefined>(undefined);
  const [labTab, setLabTab] = useState<LabTab>("single");
  const [storeTick, setStoreTick] = useState(0);
  const [projectsHydrated, setProjectsHydrated] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [autogenSubfolders, setAutogenSubfolders] = useState(true);
  const [analysisBatchName, setAnalysisBatchName] = useState("");
  const [singleRunLabel, setSingleRunLabel] = useState("");
  const [optimizationBatchName, setOptimizationBatchName] = useState("");
  const [lastOptimizationCells, setLastOptimizationCells] = useState<GridCellResult[] | null>(null);
  const [lastGridBatch, setLastGridBatch] = useState<{
    results: GridCellResult[];
    constructionLabel: string;
    levelProductLabel: string;
  } | null>(null);
  /** Bumps to clear graph node selection (new run or explicit clear). */
  const [graphSelectionVersion, setGraphSelectionVersion] = useState(0);
  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState<string[]>([]);
  const [labJobRunner, setLabJobRunner] = useState({ grid: false, optimization: false });
  const [enqueueBusy, setEnqueueBusy] = useState(false);
  const [enqueueNotice, setEnqueueNotice] = useState<string | null>(null);
  const [activeSingleBatchId, setActiveSingleBatchId] = useState<string | null>(null);
  const [hydratedQueueJobs, setHydratedQueueJobs] = useState<SimJobSummaryDto[]>([]);
  const [hydratedLabSessions, setHydratedLabSessions] = useState<LabSessionHydrationSummary[]>([]);
  const [loadingSingleBatchId, setLoadingSingleBatchId] = useState<string | null>(null);
  const hasHydrationActiveRunsRef = useRef(false);
  const prevInteractionActiveRef = useRef(false);
  const graphMeasureRef = useRef<HTMLDivElement>(null);
  const [graphBoxWidth, setGraphBoxWidth] = useState(0);

  useEffect(() => {
    hasHydrationActiveRunsRef.current =
      hydratedQueueJobs.some((job) => job.status === "queued" || job.status === "running") ||
      hydratedLabSessions.some((s) => s.status === "running");
  }, [hydratedLabSessions, hydratedQueueJobs]);

  useLayoutEffect(() => {
    const el = graphMeasureRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setGraphBoxWidth(el.getBoundingClientRect().width);
    });
    ro.observe(el);
    setGraphBoxWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const graphDims = useMemo(() => {
    const w = Math.floor(graphBoxWidth);
    // Fill measured preview column width (ResizeObserver); keep a sane floor before first layout.
    const width = w > 0 ? Math.max(240, w) : 400;
    const height = Math.round((width * 420) / 720);
    return { width, height };
  }, [graphBoxWidth]);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/wasmKernel")
      .then((m) => {
        if (!cancelled) setCompiledKernel(m.compiledMarketKernelVersion());
      })
      .catch(() => {
        if (!cancelled) setCompiledKernel(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const machineHints = useMachineResourceHints();

  const refreshProjects = useCallback(() => setStoreTick((t) => t + 1), []);
  useEffect(() => {
    setProjectsHydrated(true);
  }, []);
  const projects = useMemo(
    () => (projectsHydrated ? listProjects() : []),
    [projectsHydrated, storeTick],
  );

  useEffect(() => {
    if (selectedProjectId != null) return;
    if (projects.length > 0) setSelectedProjectId(projects[0]!.id);
  }, [projects, selectedProjectId]);

  const ensureProjectId = useCallback(() => {
    if (selectedProjectId) return selectedProjectId;
    const p = createProject("My project");
    refreshProjects();
    setSelectedProjectId(p.id);
    return p.id;
  }, [selectedProjectId, refreshProjects]);

  const resolveFolderIdForSave = useCallback(
    (tag: string) => {
      const pid = ensureProjectId();
      if (!autogenSubfolders) return activeFolderId;
      const sub = ensureAutoSubfolder(pid, activeFolderId, tag);
      refreshProjects();
      return sub ?? activeFolderId;
    },
    [activeFolderId, autogenSubfolders, ensureProjectId, refreshProjects],
  );

  useEffect(() => {
    let cancelled = false;
    const reconcile = (payload: {
      jobs?: { id: string; status: string }[];
      sessions?: { id: string; status: string }[];
    }) => {
      if (cancelled || !selectedProjectId) return;
      const project = listProjects().find((p) => p.id === selectedProjectId);
      if (!project) return;
      const jobs = new Map((payload.jobs ?? []).map((j) => [j.id, mapSimJobStatus(j.status)]));
      const sessions = new Map(
        (payload.sessions ?? []).map((s) => [s.id, mapLabSessionStatus(s.status)]),
      );
      let changed = false;
      const batches = project.batches.map((b) => {
        const ref = b.runRef;
        if (!ref || b.status !== "running") return b;
        const next =
          ref.kind === "sim_job" ? jobs.get(ref.id) : ref.kind === "lab_session" ? sessions.get(ref.id) : undefined;
        if (!next || next === b.status) return b;
        changed = true;
        return { ...b, status: next };
      });
      if (!changed) return;
      upsertProject({ ...project, batches, updatedAt: new Date().toISOString() });
      refreshProjects();
    };

    const loadOnce = async () => {
      try {
        const [jobsRes, sessionsRes] = await Promise.all([
          fetch("/api/sim/jobs", { cache: "no-store" }),
          fetch("/api/lab/sessions", { cache: "no-store" }),
        ]);
        const jobsJson = (await jobsRes.json()) as { jobs?: { id: string; status: string }[] };
        const sessionsJson = (await sessionsRes.json()) as {
          sessions?: { id: string; status: string }[];
        };
        reconcile({ jobs: jobsJson.jobs, sessions: sessionsJson.sessions });
      } catch {
        /* ignore */
      }
    };
    void loadOnce();
    const es = new EventSource("/api/sim/stream");
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as {
          jobs?: { id: string; status: string }[];
          sessions?: { id: string; status: string }[];
        };
        reconcile(parsed);
      } catch {
        /* ignore non-json events */
      }
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, [refreshProjects, selectedProjectId]);

  const effectiveHistory = run?.history ?? [];
  const sliderMax = Math.max(0, effectiveHistory.length - 1);

  const displayTick = useMemo(() => {
    if (!run?.history?.length) return null;
    const i = Math.min(tickIndex, run.history.length - 1);
    return run.history[i]!;
  }, [run, tickIndex]);

  const agentsAtTick = useMemo(() => {
    if (!run?.finalWorld || !displayTick) return null;
    return mergeAgentsWithTickSnapshot(run.finalWorld.agents, displayTick);
  }, [run, displayTick]);

  useEffect(() => {
    if (!playing || !run?.history.length) return;
    const maxIdx = run.history.length - 1;
    const id = window.setInterval(() => {
      setTickIndex((i) => {
        if (i >= maxIdx) return i;
        const next = i + 1;
        if (next >= maxIdx) {
          queueMicrotask(() => setPlaying(false));
        }
        return next;
      });
    }, 1000 / playbackTps);
    return () => window.clearInterval(id);
  }, [playing, playbackTps, run?.history.length]);

  const saveSingleToProject = useCallback(() => {
    if (!run) return;
    const pid = ensureProjectId();
    const folderId = resolveFolderIdForSave("Single");
    const batch = singleRunToBatch(singleRunLabel, run, { folderId });
    addBatchToProject(pid, batch);
    refreshProjects();
  }, [ensureProjectId, refreshProjects, resolveFolderIdForSave, run, singleRunLabel]);

  const onGridBatchFinished = useCallback(
    (
      results: GridCellResult[],
      meta: {
        sessionId: string | null;
        cancelled: boolean;
        gridConstruction: GridConstructionMode;
        constructionLabel: string;
        levelProductLabel: string;
      },
    ) => {
      if (results.length === 0 && !meta.sessionId) return;
      setLastGridBatch({
        results,
        constructionLabel: meta.constructionLabel,
        levelProductLabel: meta.levelProductLabel,
      });
      const pid = ensureProjectId();
      const folderId = resolveFolderIdForSave("Grid");
      const batch = gridResultsToBatch(
        analysisBatchName.trim() || `Grid ${new Date().toISOString().slice(0, 19)}`,
        results,
        meta.constructionLabel,
        meta.levelProductLabel,
        {
          id: meta.sessionId ? `lab_${meta.sessionId}` : undefined,
          kind: "grid",
          status: meta.cancelled ? "cancelled" : "done",
          runRef: meta.sessionId ? { kind: "lab_session", id: meta.sessionId } : undefined,
          folderId,
        },
      );
      addBatchToProject(pid, batch);
      refreshProjects();
    },
    [analysisBatchName, ensureProjectId, refreshProjects, resolveFolderIdForSave],
  );

  const onOptimizationSessionFinished = useCallback(
    (cells: GridCellResult[], meta: { sessionId: string | null; cancelled: boolean }) => {
      setLastOptimizationCells(cells.length > 0 ? cells : null);
      if (cells.length === 0 && !meta.sessionId) return;
      const pid = ensureProjectId();
      const folderId = resolveFolderIdForSave("Optimize");
      const batch = gridResultsToBatch(
        optimizationBatchName.trim() || `Optimization ${new Date().toISOString().slice(0, 19)}`,
        cells,
        "Genetic search",
        `${cells.length} trials`,
        {
          id: meta.sessionId ? `lab_${meta.sessionId}` : undefined,
          kind: "optimization",
          status: meta.cancelled ? "cancelled" : "done",
          runRef: meta.sessionId ? { kind: "lab_session", id: meta.sessionId } : undefined,
          folderId,
        },
      );
      addBatchToProject(pid, batch);
      refreshProjects();
    },
    [ensureProjectId, optimizationBatchName, refreshProjects, resolveFolderIdForSave],
  );

  const onGridSessionStarted = useCallback(
    (meta: {
      sessionId: string;
      gridConstruction: GridConstructionMode;
      constructionLabel: string;
      levelProductLabel: string;
    }) => {
      const pid = ensureProjectId();
      const folderId = resolveFolderIdForSave("Grid");
      addBatchToProject(
        pid,
        createPendingBatch({
          id: `lab_${meta.sessionId}`,
          name: analysisBatchName.trim() || `Grid ${new Date().toISOString().slice(0, 19)}`,
          kind: "grid",
          folderId,
          runRef: { kind: "lab_session", id: meta.sessionId },
        }),
      );
      refreshProjects();
    },
    [analysisBatchName, ensureProjectId, refreshProjects, resolveFolderIdForSave],
  );

  const onOptimizationSessionStarted = useCallback(
    (meta: { sessionId: string }) => {
      const pid = ensureProjectId();
      const folderId = resolveFolderIdForSave("Optimize");
      addBatchToProject(
        pid,
        createPendingBatch({
          id: `lab_${meta.sessionId}`,
          name: optimizationBatchName.trim() || `Optimization ${new Date().toISOString().slice(0, 19)}`,
          kind: "optimization",
          folderId,
          runRef: { kind: "lab_session", id: meta.sessionId },
        }),
      );
      refreshProjects();
    },
    [ensureProjectId, optimizationBatchName, refreshProjects, resolveFolderIdForSave],
  );

  const exportLastGridBatchJson = useCallback(() => {
    if (!lastGridBatch?.results.length) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            kind: "grid_batch_export",
            exportedAt: new Date().toISOString(),
            constructionLabel: lastGridBatch.constructionLabel,
            levelProductLabel: lastGridBatch.levelProductLabel,
            cells: lastGridBatch.results.map((r) => ({
              id: r.id,
              label: r.label,
              assignments: r.assignments,
              run: { manifest: r.run.manifest, history: r.run.history, finalWorld: r.run.finalWorld },
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ip-abm-grid-batch-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lastGridBatch]);

  const exportLastOptimizationJson = useCallback(() => {
    if (!lastOptimizationCells?.length) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            kind: "optimization_export",
            exportedAt: new Date().toISOString(),
            trials: lastOptimizationCells.map((r) => ({
              id: r.id,
              label: r.label,
              assignments: r.assignments,
              run: { manifest: r.run.manifest, history: r.run.history, finalWorld: r.run.finalWorld },
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ip-abm-optimization-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lastOptimizationCells]);

  const loadStoredSingleBatch = useCallback(
    async (batch: AnalysisBatch) => {
      if (batch.kind !== "single") return;
      setLoadingSingleBatchId(batch.id);
      try {
        let selected = batch;
        if (shouldFetchSimJobDetailOnSelection(selected) && selected.runRef?.kind === "sim_job") {
          const detailRes = await fetch(simJobDetailPath(selected.runRef.id), { cache: "no-store" });
          const parsed = parseSimJobDetailResponse(await detailRes.json());
          if (!detailRes.ok || parsed.error || !parsed.detail || parsed.detail.status !== "done") {
            throw new Error(parsed.error ?? detailRes.statusText);
          }
          if (typeof parsed.detail.result_json !== "string" || parsed.detail.result_json.length === 0) {
            throw new Error("Selected run has no persisted result payload.");
          }
          const hydrated = attachSimJobResultToBatch(selected, parsed.detail.result_json);
          if (!hydrated?.fullRunJson) {
            throw new Error("Selected run payload is not a replayable simulation run.");
          }
          selected = hydrated;
          const project = listProjects().find((p) => p.id === selectedProjectId);
          if (project) {
            const nextBatches = project.batches.map((b) => (b.id === selected.id ? selected : b));
            upsertProject({ ...project, batches: nextBatches, updatedAt: new Date().toISOString() });
            refreshProjects();
          }
        }
        if (!selected.fullRunJson) {
          throw new Error("Selected run payload is not available yet.");
        }
        const revived = reviveStoredSingleRun(selected.fullRunJson);
        setPlaying(false);
        setCompareRun(null);
        setGraphSelectionVersion((v) => v + 1);
        setRun(revived);
        setTickIndex(revived.history.length - 1);
        const next = revived.manifest.config;
        setConfig(next);
        const n = totalAgents(next.agentCounts);
        setPopulationPlannedTotal(n);
        setPopulationPctTenths(countsToPctTenths(next.agentCounts));
        setPopulationPctDirty(freshPopulationPctDirty());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingSingleBatchId((prev) => (prev === batch.id ? null : prev));
      }
    },
    [refreshProjects, selectedProjectId],
  );

  const loadGridCell = useCallback((cell: GridCellResult) => {
    setPlaying(false);
    setCompareRun(null);
    setGraphSelectionVersion((v) => v + 1);
    setRun(cell.run);
    setTickIndex(cell.run.history.length - 1);
    const next = cell.run.manifest.config;
    setConfig(next);
    const n = totalAgents(next.agentCounts);
    setPopulationPlannedTotal(n);
    setPopulationPctTenths(countsToPctTenths(next.agentCounts));
    setPopulationPctDirty(freshPopulationPctDirty());
  }, []);

  const exportWebm = useCallback(async () => {
    if (!run?.history.length) return;
    setExportingVideo(true);
    try {
      const blob = await encodeReplayWebm(run.history, {
        fps: 12,
        subtitle: `seed ${run.manifest.seed} · agents ~${totalAgents(run.manifest.config.agentCounts)}`,
      });
      if (!blob) {
        alert("WebM encoding not supported in this browser.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ip-abm-replay-${run.manifest.seed}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingVideo(false);
    }
  }, [run]);

  const exportGif = useCallback(async () => {
    if (!run?.history.length) return;
    setExportingGif(true);
    try {
      const blob = await encodeReplayGif(run.history, {
        fps: 12,
        subtitle: `seed ${run.manifest.seed} · agents ~${totalAgents(run.manifest.config.agentCounts)}`,
      });
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ip-abm-replay-${run.manifest.seed}.gif`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingGif(false);
    }
  }, [run]);

  const runSync = useCallback(async () => {
    setError(null);
    setRunning(true);
    const pid = ensureProjectId();
    const pendingSingle = createPendingBatch({
      id: activeSingleBatchId ?? undefined,
      name: singleRunLabel.trim() || `Run ${new Date().toISOString().slice(0, 19)}`,
      kind: "single",
      runRef: { kind: "sim_job", id: `local_${Date.now()}` },
      status: "running",
      folderId: activeFolderId,
    });
    setActiveSingleBatchId(pendingSingle.id);
    addBatchToProject(pid, pendingSingle);
    refreshProjects();
    try {
      const manifestBase = {
        seed: config.seed,
        policyMode: mode,
        qreTemperature: mode === "qre" ? qreTemp : undefined,
        llmModel: undefined,
      };
      let result: (SimulationRun & { finalWorld?: WorldState }) | undefined;
      if (mode === "heuristic") {
        result = await runSimulationHeuristicWasm(config);
      } else if (mode === "qre") {
        result = runSimulationSync({
          config,
          manifest: { ...manifestBase, policyMode: "qre", qreTemperature: qreTemp },
          decide: (w: WorldState, agent: AgentState) =>
            qrePolicy(agent, w, { temperature: qreTemp, seedSalt: config.seed }),
        });
      }
      if (result) {
        setPlaying(false);
        if (run) {
          const { finalWorld: _, ...prior } = run as SimulationRun & {
            finalWorld?: WorldState;
          };
          setCompareRun(prior);
        }
        setGraphSelectionVersion((v) => v + 1);
        setRun(result);
        setTickIndex(result.history.length - 1);
        const doneBatch = singleRunToBatch(singleRunLabel, result, {
          id: pendingSingle.id,
          status: "done",
          runRef: pendingSingle.runRef,
          folderId: pendingSingle.folderId,
        });
        addBatchToProject(pid, doneBatch);
        refreshProjects();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      addBatchToProject(pid, { ...pendingSingle, status: "failed" });
      refreshProjects();
    } finally {
      setRunning(false);
    }
  }, [
    activeFolderId,
    activeSingleBatchId,
    config,
    ensureProjectId,
    mode,
    qreTemp,
    refreshProjects,
    run,
    singleRunLabel,
  ]);

  const runLlm = useCallback(async () => {
    setError(null);
    setRunning(true);
    const pid = ensureProjectId();
    const pendingSingle = createPendingBatch({
      id: activeSingleBatchId ?? undefined,
      name: singleRunLabel.trim() || `Run ${new Date().toISOString().slice(0, 19)}`,
      kind: "single",
      runRef: { kind: "sim_job", id: `local_${Date.now()}` },
      status: "running",
      folderId: activeFolderId,
    });
    setActiveSingleBatchId(pendingSingle.id);
    addBatchToProject(pid, pendingSingle);
    refreshProjects();
    try {
      const result = await runSimulationAsync({
        config,
        manifest: {
          seed: config.seed,
          policyMode: "llm",
        },
        decide: async (world: WorldState, agent: AgentState) => {
          const obs = buildObservation(agent, world);
          const res = await fetch("/api/llm-action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ observation: obs }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? `LLM API ${res.status}`);
          }
          const j = (await res.json()) as { action: string };
          if (!validateAction(j.action)) throw new Error(`Invalid action: ${j.action}`);
          return j.action as Action;
        },
      });
      setPlaying(false);
      if (run) {
        const { finalWorld: _, ...prior } = run as SimulationRun & {
          finalWorld?: WorldState;
        };
        setCompareRun(prior);
      }
      setGraphSelectionVersion((v) => v + 1);
      setRun(result);
      setTickIndex(result.history.length - 1);
      const doneBatch = singleRunToBatch(singleRunLabel, result, {
        id: pendingSingle.id,
        status: "done",
        runRef: pendingSingle.runRef,
        folderId: pendingSingle.folderId,
      });
      addBatchToProject(pid, doneBatch);
      refreshProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      addBatchToProject(pid, { ...pendingSingle, status: "failed" });
      refreshProjects();
    } finally {
      setRunning(false);
    }
  }, [
    activeFolderId,
    activeSingleBatchId,
    config,
    ensureProjectId,
    refreshProjects,
    run,
    singleRunLabel,
  ]);

  const onRun = () => {
    if (mode === "llm") void runLlm();
    else void runSync();
  };

  const onEnqueueRun = useCallback(async () => {
    setEnqueueNotice(null);
    if (mode === "llm") {
      setError("Queued runs support heuristic and QRE only — switch policy or use Run for LLM.");
      return;
    }
    setEnqueueBusy(true);
    try {
      const pid = ensureProjectId();
      const folderId = resolveFolderIdForSave("Queue");
      const policyMode = mode === "heuristic" ? "heuristic" : "qre";
      const res = await fetch("/api/sim/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config,
          policyMode,
          qreTemp: policyMode === "qre" ? qreTemp : undefined,
        }),
      });
      const j = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      if (j.id) {
        addBatchToProject(
          pid,
          createPendingBatch({
            id: `job_${j.id}`,
            name: `Queued run ${j.id.slice(0, 8)}`,
            kind: "single",
            folderId,
            runRef: { kind: "sim_job", id: j.id },
          }),
        );
        refreshProjects();
      }
      setEnqueueNotice(`Queued job ${j.id?.slice(0, 8) ?? ""}… — open Queue tab and run pnpm sim:worker locally.`);
      setLabTab("queue");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnqueueBusy(false);
    }
  }, [config, ensureProjectId, mode, qreTemp, refreshProjects, resolveFolderIdForSave]);

  const onGridLabJobRunner = useCallback((active: boolean) => {
    setLabJobRunner((r) => ({ ...r, grid: active }));
  }, []);
  const onOptimizationLabJobRunner = useCallback((active: boolean) => {
    setLabJobRunner((r) => ({ ...r, optimization: active }));
  }, []);

  useEffect(() => {
    let alive = true;
    let sseConnected = false;
    let timer: number | null = null;
    const refreshHydration = async () => {
      try {
        const [jobsRes, sessionsRes] = await Promise.all([
          fetch("/api/sim/jobs", { cache: "no-store" }),
          fetch("/api/lab/sessions", { cache: "no-store" }),
        ]);
        const jobsParsed = parseSimJobsListResponse(await jobsRes.json());
        if (jobsRes.ok && !jobsParsed.error && alive) {
          setHydratedQueueJobs(jobsParsed.jobs);
        }
        const sessionsParsed = normalizeLabSessionsForHydration(await sessionsRes.json());
        if (sessionsRes.ok && alive) {
          setHydratedLabSessions(sessionsParsed);
        }
      } catch {
        /* Keep existing hydration state on transient API errors. */
      }
    };
    void refreshHydration();
    const es = new EventSource("/api/sim/stream");
    es.onopen = () => {
      sseConnected = true;
    };
    es.onerror = () => {
      sseConnected = false;
    };
    es.onmessage = (ev) => {
      const parsed = parseQueueLabStreamPayload(ev.data);
      if (!parsed.ok) return;
      if (!alive) return;
      setHydratedQueueJobs(parsed.data.jobs);
      setHydratedLabSessions((prev) =>
        parsed.data.sessions.map((s) => {
          const existing = prev.find((p) => p.id === s.id);
          return {
            ...s,
            meta: existing?.meta,
          };
        }),
      );
    };
    const scheduleRefresh = () => {
      if (!alive) return;
      const tabVisible = typeof document === "undefined" ? true : document.visibilityState === "visible";
      const delay = queuePollingIntervalMs({
        sseConnected,
        hasActiveRuns: hasHydrationActiveRunsRef.current,
        tabVisible,
      });
      timer = window.setTimeout(async () => {
        await refreshHydration();
        scheduleRefresh();
      }, delay);
    };
    scheduleRefresh();
    return () => {
      alive = false;
      es.close();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  const hydratedActive = useMemo(
    () => deriveActiveRunHydrationState({ jobs: hydratedQueueJobs, sessions: hydratedLabSessions }),
    [hydratedLabSessions, hydratedQueueJobs],
  );

  useEffect(() => {
    const nextActive = isLabInteractionActive({
      running,
      enqueueBusy,
      gridRunnerActive: labJobRunner.grid,
      optimizationRunnerActive: labJobRunner.optimization,
    });
    const prevActive = prevInteractionActiveRef.current;
    if (shouldClearStaleOverlay(prevActive, nextActive)) {
      window.dispatchEvent(new CustomEvent("ip-lab:clear-stale-overlay"));
    }
    prevInteractionActiveRef.current = nextActive;
  }, [enqueueBusy, labJobRunner.grid, labJobRunner.optimization, running]);

  const downloadJson = () => {
    if (!run) return;
    const { finalWorld: _fw, ...rest } = run as SimulationRun & {
      finalWorld?: WorldState;
    };
    const blob = new Blob([serializeRun(rest)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ip-abm-run-${config.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-[100dvh] w-full min-w-0 flex-row items-start gap-2 md:gap-3">
      <ProjectSidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onCreateProject={(name) => {
          const p = createProject(name);
          refreshProjects();
          setSelectedProjectId(p.id);
        }}
        activeFolderId={activeFolderId}
        onSelectFolder={setActiveFolderId}
        autogenSubfolders={autogenSubfolders}
        onAutogenChange={setAutogenSubfolders}
        onCreateFolder={(parentId, name) => {
          if (!selectedProjectId) return;
          createFolder(selectedProjectId, name, parentId);
          refreshProjects();
        }}
        onLoadSingleBatch={loadStoredSingleBatch}
        loadingSingleBatchId={loadingSingleBatchId}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex min-h-[min(92vh,880px)] min-w-0 w-full flex-1 flex-col gap-2 lg:min-h-0 lg:basis-0 lg:shrink lg:grow-[0.9]">
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border)] pb-1" role="tablist">
          {(["single", "grid", "optimize", "queue"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={labTab === tab}
              className={`rounded px-3 py-1.5 text-xs font-medium ${
                labTab === tab ? "bg-[#1f1f26] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[#141418]"
              }`}
              onClick={() => setLabTab(tab)}
            >
              {tab === "single"
                ? "Single run"
                : tab === "grid"
                  ? "Grid"
                  : tab === "optimize"
                    ? "Optimize"
                    : "Queue"}
            </button>
          ))}
        </div>
        <LabJobBanner
          labTab={labTab}
          gridRunnerActive={labJobRunner.grid}
          optimizationRunnerActive={labJobRunner.optimization}
          onRequestTab={setLabTab}
        />
        {error ? (
          <p className="shrink-0 rounded border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-200">{error}</p>
        ) : null}
        {enqueueNotice ? (
          <p className="shrink-0 rounded border border-emerald-900/50 bg-emerald-950/35 p-2 text-xs text-emerald-100">
            {enqueueNotice}
          </p>
        ) : null}
        <div
          className={`min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel)] lg:min-h-0 lg:max-h-[min(92vh,880px)] lg:overflow-y-auto lg:overscroll-contain ${
            labTab === "optimize" ? "p-2 lg:p-2" : "p-3"
          }`}
        >
          {labTab === "single" ? (
            <div className="min-w-0 space-y-2">
        {hydratedActive.singleJob ? (
          <div className="rounded-md border border-sky-900/45 bg-sky-950/25 px-2.5 py-1.5 text-[11px] text-sky-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">Currently running in queue</span>
                <span className="text-sky-200/85">
                  {" "}
                  · {hydratedActive.singleJob.status} · {hydratedActive.singleJob.id.slice(0, 8)}…
                </span>
              </span>
              <button
                type="button"
                className="rounded border border-sky-800/60 px-2 py-0.5 text-[10px] text-sky-50 hover:bg-sky-950/60"
                onClick={() => setLabTab("queue")}
              >
                Open Queue
              </button>
            </div>
            {hydratedActive.singleJob.progress_note ? (
              <p className="mt-0.5 text-[10px] text-sky-200/80">{hydratedActive.singleJob.progress_note}</p>
            ) : null}
          </div>
        ) : null}
        <h2 className="flex items-center gap-1 text-sm font-medium">
          Run configuration
          <ParamHelp text="All controls here define a single experiment design: population, IP policy, regulation, innovation costs, and how agents decide actions. Changing values does not auto-run until you press Run." />
        </h2>
        <p className="font-mono-n text-[10px] leading-snug text-[var(--muted)]">
          <span className="inline-flex flex-wrap items-center gap-1">
            WASM heuristic · kernel{" "}
            {compiledKernel === undefined
              ? "…"
              : compiledKernel === null
                ? "—"
                : `v${compiledKernel}`}{" "}
            · QRE/LLM = TS
            <ParamHelp text="Heuristic policy runs the full simulation in Rust WebAssembly (JSON in/out). QRE and LLM still execute in the TypeScript @ip-sim/core engine. The version string is the optional compiled market kernel helper (market_raw_weights); it is not a multi-core worker pool." />
          </span>
        </p>
        <p className="font-mono-n text-[10px] leading-snug text-[var(--muted)]">
          <span className="inline-flex flex-wrap items-center gap-1">
            {formatMachineHintsOneLine(machineHints)}
            <ParamHelp text="Same hints as the parameter grid: logical CPUs from navigator.hardwareConcurrency; JS heap cap from performance.memory on Chromium only—not OS RAM. The page cannot reserve machine resources." />
          </span>
        </p>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Population
            <ParamHelp text="Live cohort shows current total. Mix uses 0.1% steps summing to 100%; integer counts follow Hamilton (largest remainder) for planned N. Planned N and the four percentage fields drive agentCounts. Grid imports reset the mix and clear edited markers until you change fields again. Autofill adjusts only cohorts you have not edited; if all four are edited, slack is split among non-focused keys. The row always sums to 100%; editing one slice keeps other edited percentages fixed when possible and fills the remainder on untouched fields (proportional Hamilton in that subspace)." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <p className="font-mono-n text-[10px] text-[var(--muted)] sm:col-span-2">
              Cohort {totalAgents(config.agentCounts)} · mix 0.1% · Hamilton → counts
            </p>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Planned headcount for the initial world. Cohort counts are derived from the percentage mix using Hamilton (largest-remainder) rounding so the four integers sum exactly to N.">
                  Planned N
                </FieldLabel>
              </label>
              <input
                type="number"
                min={1}
                step={1}
                aria-label="Planned total agents"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={populationPlannedTotal}
                onChange={(e) => {
                  const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  setPopulationPlannedTotal(n);
                  setConfig((c) => ({
                    ...c,
                    agentCounts: pctTenthsToAgentCounts(populationPctTenths, n),
                  }));
                }}
              />
            </div>
            <p className="flex min-w-0 items-baseline font-mono-n text-[10px] leading-tight text-[var(--muted)]">
              <span className="min-w-0 break-words">
                bigco {config.agentCounts.bigco} · acad {config.agentCounts.academic} · smb{" "}
                {config.agentCounts.smb} · solo {config.agentCounts.solo} · Σ{" "}
                {totalAgents(config.agentCounts)}
              </span>
            </p>
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:col-span-2">
              {(["bigco", "academic", "smb", "solo"] as const).map((t) => (
                <div key={t} className="min-w-0">
                  <label className="text-xs capitalize text-[var(--muted)]">
                    <FieldLabel
                      help={
                        t === "bigco"
                          ? "Large firms: higher baseline labor and knowledge; stronger weight in competitive demand unless offset by policy."
                          : t === "academic"
                            ? "Universities/labs: labor tilt toward services in production; receive open-science stipends tied to subsidy."
                            : t === "smb"
                              ? "SMBs: medium endowments; same action set with type-specific starting stocks and CES labor split."
                              : "Solo entrepreneurs: smallest teams; participate in the same market and network mechanisms with lighter endowments."
                      }
                    >
                      {t} %
                      {populationPctDirty[t] ? (
                        <span className="ml-0.5 text-[10px] font-normal normal-case text-[var(--muted)]">
                          (edited)
                        </span>
                      ) : null}
                    </FieldLabel>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    aria-label={`${t} mix percent`}
                    className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                    value={tenthsToPercentage(populationPctTenths[t])}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      const raw = Number.isFinite(v) ? percentageToTenths(v) : 0;
                      const { tenths, dirty } = rebalancePctTenthsAfterFieldEdit({
                        current: populationPctTenths,
                        dirty: populationPctDirty,
                        editedKey: t,
                        newTenthsRaw: raw,
                      });
                      setPopulationPctTenths(tenths);
                      setPopulationPctDirty(dirty);
                      setConfig((c) => ({
                        ...c,
                        agentCounts: pctTenthsToAgentCounts(tenths, populationPlannedTotal),
                      }));
                    }}
                  />
                  <div className="mt-0.5 font-mono-n text-[10px] text-[var(--muted)]">
                    → {config.agentCounts[t]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Simulation length
            <ParamHelp text="Master seed drives pseudo-random draws (world setup, per-tick RNG). Same seed and settings reproduce the same run. Ticks are discrete time steps: each tick runs actions, collaboration/trade pairing, market revenue (edge-logit demand by default), regulation if enabled, depreciation, then advances time." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Master seed for pseudo-random draws (world setup, per-tick RNG streams). Same seed and settings reproduce the same run—useful for replication and diffing policy changes.">
                  Seed
                </FieldLabel>
              </label>
              <input
                type="number"
                aria-label="Random seed"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.seed}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, seed: Number(e.target.value) || 0 }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Number of discrete time steps. Each tick: actions, collaboration/trade pairing, market revenue (edge-logit demand by default), regulation if enabled, depreciation, then advance time.">
                  Ticks
                </FieldLabel>
              </label>
              <input
                type="number"
                aria-label="Simulation ticks"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.ticks}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, ticks: Math.max(1, Number(e.target.value) || 1) }))
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            IP &amp; disclosure
            <ParamHelp text="Patent regime sets strength of exclusive-rights treatment (filing cost tiers, per-patent licensing uplift; “none” removes patent licensing and applies a global-pool–linked openness bonus). Duration is ticks per grant. Enforcement scales litigation-style transfers when patents overlap. Open-science subsidy lowers publication cost and magnifies spillovers into the global pool. Data-sharing mandate complements that with reproducibility pressure on published findings." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Strength of exclusive-rights treatment: affects filing cost tiers and per-patent licensing uplift in market revenue. “None (open)” removes patent licensing but applies a global-pool–linked openness bonus instead.">
                  Patent regime
                </FieldLabel>
              </label>
              <select
                aria-label="Patent regime"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-sm"
                value={config.policy.patentRegime}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: {
                      ...c.policy,
                      patentRegime: e.target.value as SimConfig["policy"]["patentRegime"],
                    },
                  }))
                }
              >
                <option value="none">None (open)</option>
                <option value="weak">Weak</option>
                <option value="strong">Strong</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="How many ticks each granted patent remains active before expiry (discrete-time counterpart of patent term). Shorter terms rotate exclusivity faster; longer terms extend licensing returns.">
                  Patent duration
                </FieldLabel>
              </label>
              <input
                type="number"
                aria-label="Patent duration in ticks"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.policy.patentDurationTicks}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: {
                      ...c.policy,
                      patentDurationTicks: Math.max(1, Number(e.target.value) || 1),
                    },
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Scales the strength/cost of IP enforcement actions (litigation-style transfers when overlapping patents exist). Higher values intensify deterrence and dispute spending in the model.">
                  Enforcement
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Enforcement intensity"
                className="mt-1 w-full min-w-0"
                min={0}
                max={1}
                step={0.05}
                value={config.policy.enforcementIntensity}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: { ...c.policy, enforcementIntensity: Number(e.target.value) },
                  }))
                }
              />
              <div className="font-mono-n text-[10px] text-[var(--muted)]">
                {config.policy.enforcementIntensity.toFixed(2)}
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Public support that lowers the wealth cost of open publication and magnifies knowledge spillovers into the global pool (policy lever for disclosure vs secrecy).">
                  Open science subsidy
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Open science subsidy"
                className="mt-1 w-full min-w-0"
                min={0}
                max={1}
                step={0.05}
                value={config.policy.openScienceSubsidy}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: { ...c.policy, openScienceSubsidy: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Regulatory pressure for reproducibility/data openness: increases the spillover multiplier when findings are published openly (complements the open-science subsidy channel).">
                  Data-sharing mandate
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Data-sharing mandate strength"
                className="mt-1 w-full min-w-0"
                min={0}
                max={1}
                step={0.05}
                value={config.policy.dataSharingMandateStrength}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: {
                      ...c.policy,
                      dataSharingMandateStrength: Number(e.target.value),
                    },
                  }))
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Regulation
            <ParamHelp text="When on, each tick maps sector-specific offering characteristics into signed social loads, applies transfers weighted by vulnerability, and mitigates net harms using policymaker stringency (fixed level vs persistent noisy process). Enable regulatory pressure turns on the externality module. Rule dynamics: fixed tracks ambition each tick without persistence; dynamic follows a mean-reverting noisy process. Regulatory ambition feeds effective stringency with scale and corruption. Bribe action is a costly influence move with detection risk." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-[var(--border)]"
                checked={config.regulatory.enabled}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    regulatory: { ...c.regulatory, enabled: e.target.checked },
                  }))
                }
              />
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
                Enable regulation
                <ParamHelp text="Turns on the externality module: offerings contribute channel-specific social costs/benefits that regulators can tax or repair relative to an evolving stringency target." />
              </span>
            </label>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Fixed: stringency tracks ambition each tick without persistence. Dynamic: stringency follows a mean-reverting process with noise—rules drift and respond gradually like evolving standards.">
                  Rule dynamics
                </FieldLabel>
              </label>
              <select
                aria-label="Regulatory rule dynamics"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-sm"
                value={config.regulatory.ruleMode}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    regulatory: {
                      ...c.regulatory,
                      ruleMode: e.target.value as SimConfig["regulatory"]["ruleMode"],
                    },
                  }))
                }
              >
                <option value="fixed">Fixed</option>
                <option value="dynamic">Dynamic</option>
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Desired baseline strictness of mitigation (feeds effective stringency together with scale and corruption). Higher ambition pushes faster reduction of aggregated net harm when regulation is enabled.">
                  Reg. ambition
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Regulatory ambition"
                className="mt-1 w-full min-w-0"
                min={0}
                max={1}
                step={0.05}
                value={config.policy.regulatoryAmbition}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    policy: { ...c.policy, regulatoryAmbition: Number(e.target.value) },
                  }))
                }
              />
              <div className="font-mono-n text-[10px] text-[var(--muted)]">
                {config.policy.regulatoryAmbition.toFixed(2)}
              </div>
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-[var(--border)]"
                checked={config.regulatory.bribe.enabled}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    regulatory: {
                      ...c.regulatory,
                      bribe: { ...c.regulatory.bribe, enabled: e.target.checked },
                    },
                  }))
                }
              />
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
                Allow bribe_regulator
                <ParamHelp text="Permits a costly influence action: success may weaken enforcement stringency via corruption; detection triggers fines and stock penalties—capturing regulatory capture risk in reduced form." />
              </span>
            </label>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Governance
            <ParamHelp text="Optional civic roles on top of economic types. Each election period: demote politicians, trim/hire fire-at-will servants, tenure promotions, then fill legislative seats by reputation (plus noise). Tenured servants skip firing. Off by default; when on, role counts appear in tick metrics / JSON export, and the graph uses civic fills (economic type as outlines) when any agent holds office." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2 lg:col-span-4">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-[var(--border)]"
                checked={config.governance.enabled}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    governance: { ...c.governance, enabled: e.target.checked },
                  }))
                }
              />
              <span>Enable governance</span>
            </label>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="How often (in completed world ticks) the full civic pass runs: incumbent politicians step down, fire-at-will servants may be dismissed to meet targets, hiring refills servant slots, tenure promotions run, then legislative seats are filled by electoral score.">
                  Election period
                </FieldLabel>
              </label>
              <input
                type="number"
                min={1}
                aria-label="Election period in ticks"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.governance.electionPeriodTicks}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    governance: {
                      ...c.governance,
                      electionPeriodTicks: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    },
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Number of legislative seats filled each maintenance pass from the candidate pool (citizens + public servants) by highest electoral score.">
                  Politician seats
                </FieldLabel>
              </label>
              <input
                type="number"
                min={0}
                aria-label="Politician seats"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.governance.politicianSeats}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    governance: {
                      ...c.governance,
                      politicianSeats: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    },
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Target headcount for fire-at-will public servants after each maintenance pass.">
                  Fireable servants
                </FieldLabel>
              </label>
              <input
                type="number"
                min={0}
                aria-label="Fireable servant target"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.governance.fireableServantTarget}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    governance: {
                      ...c.governance,
                      fireableServantTarget: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    },
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Target tenured (non-fireable) servants; promoted from eligible fireable staff when slots are short.">
                  Tenured servants
                </FieldLabel>
              </label>
              <input
                type="number"
                min={0}
                aria-label="Tenured servant target"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.governance.tenuredServantTarget}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    governance: {
                      ...c.governance,
                      tenuredServantTarget: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    },
                  }))
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Population growth
            <ParamHelp text="Optional endogenous entry: new agents can appear through recruitment/spin-out, expanding the network until a population ceiling is hit. If spawn is enabled, eligible agents may pay to add a new actor—useful for studying ecosystem expansion vs fixed population." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 rounded border-[var(--border)]"
                checked={config.spawn.enabled}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    spawn: { ...c.spawn, enabled: e.target.checked },
                  }))
                }
              />
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
                Allow spawn_agent
                <ParamHelp text="If enabled, eligible agents may pay to add a new actor—useful for studying ecosystem expansion vs fixed-population dynamics." />
              </span>
            </label>
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Upper bound on total agents when spawning is on; prevents runaway growth and keeps computation bounded (hard stop for new entries).">
                  Max agents
                </FieldLabel>
              </label>
              <input
                type="number"
                min={2}
                aria-label="Maximum agents cap"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.spawn.maxAgents}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    spawn: {
                      ...c.spawn,
                      maxAgents: Math.max(2, Math.floor(Number(e.target.value) || 2)),
                    },
                  }))
                }
              />
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Innovation &amp; decay
            <ParamHelp text="Innovation parameters shape how expensive and delayed knowledge creation is; depreciation rates model obsolescence and forgetting between ticks." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Fixed wealth spent before stochastic and knowledge-linked components when an agent chooses invest-in-R&amp;D—baseline difficulty of research projects.">
                  R&amp;D base cost
                </FieldLabel>
              </label>
              <input
                type="number"
                step={0.5}
                aria-label="R and D base cost"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.investRndBaseCost}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    investRndBaseCost: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Half-width of uniform noise added to R&amp;D cost draws—captures project heterogeneity and unpredictability of research spend.">
                  R&amp;D cost span
                </FieldLabel>
              </label>
              <input
                type="number"
                step={0.5}
                aria-label="R and D cost random span"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.investRndCostRandomSpan}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    investRndCostRandomSpan: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Extra marginal cost per unit of current knowledge stock—models complexity creep: larger knowledge bases make further advances more expensive to attempt.">
                  R&amp;D / knowledge
                </FieldLabel>
              </label>
              <input
                type="number"
                step={0.01}
                aria-label="R and D cost per knowledge"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.investRndCostPerKnowledge}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    investRndCostPerKnowledge: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Pipeline lag between committing R&amp;D and receiving knowledge payoffs (integer ticks). Mimics development and trial phases; longer delay slows the innovation feedback loop.">
                  Innov. delay
                </FieldLabel>
              </label>
              <input
                type="number"
                min={0}
                aria-label="Innovation delay ticks"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 font-mono-n text-sm"
                value={config.innovationDelayTicks}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    innovationDelayTicks: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
              />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Multiplicative decay of wealth each tick (maintenance, consumption, capital loss). Higher values erode cash balances faster between market rounds.">
                  Wealth depreciation / tick
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Wealth depreciation rate"
                className="mt-1 w-full min-w-0"
                min={0}
                max={0.2}
                step={0.005}
                value={config.wealthDepreciationRate}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    wealthDepreciationRate: Number(e.target.value),
                  }))
                }
              />
              <div className="font-mono-n text-[10px] text-[var(--muted)]">
                {config.wealthDepreciationRate.toFixed(3)}
              </div>
            </div>
            <div className="min-w-0 lg:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Knowledge stock lost to obsolescence or forgetting each tick. Higher values make proprietary know-how decay unless continuously replenished.">
                  Knowledge depreciation / tick
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Knowledge depreciation rate"
                className="mt-1 w-full min-w-0"
                min={0}
                max={0.2}
                step={0.005}
                value={config.knowledgeDepreciationRate}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    knowledgeDepreciationRate: Number(e.target.value),
                  }))
                }
              />
              <div className="font-mono-n text-[10px] text-[var(--muted)]">
                {config.knowledgeDepreciationRate.toFixed(3)}
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-2 border-t border-[var(--border)] pt-2">
          <h3 className="flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
            Decision policy
            <ParamHelp text="How agents choose actions: fast hand-tuned rules (heuristic), quantal-response equilibrium sampling from softmax utilities (QRE), or API-backed LLM decisions (slow, requires server). QRE temperature: low concentrates on best actions; high adds randomization (exploration vs exploitation)." />
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className={`min-w-0 ${mode === "qre" ? "" : "sm:col-span-2"}`}>
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="How agents choose actions: fast hand-tuned rules (heuristic), quantal-response equilibrium sampling from softmax utilities (QRE), or API-backed LLM decisions (slow, requires server).">
                  Policy mode
                </FieldLabel>
              </label>
              <select
                aria-label="Policy mode"
                className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-sm"
                value={mode}
                onChange={(e) => setMode(e.target.value as PolicyMode)}
              >
                <option value="heuristic">Heuristic (fast)</option>
                <option value="qre">QRE / softmax (fast)</option>
                <option value="llm">LLM (API · slow)</option>
              </select>
            </div>
            {mode === "qre" && (
              <div className="min-w-0">
                <label className="block text-xs text-[var(--muted)]">
                  <FieldLabel help="Softmax temperature in QRE: low values concentrate probability on the highest-utility actions (more “rational”); high values randomize more—exploration vs exploitation in discrete choice.">
                    QRE temperature
                  </FieldLabel>
                </label>
                <input
                  type="range"
                  aria-label="QRE temperature"
                  className="mt-1 w-full min-w-0"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={qreTemp}
                  onChange={(e) => setQreTemp(Number(e.target.value))}
                />
                <div className="font-mono-n text-[10px] text-[var(--muted)]">{qreTemp.toFixed(2)}</div>
              </div>
            )}
          </div>
        </section>

        <div className="mt-2 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 sm:items-start">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                disabled={running}
                aria-busy={running}
                onClick={onRun}
                className="min-w-0 flex-1 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  {running ? (
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{running ? "Running…" : "Run simulation"}</span>
                </span>
              </button>
              <ParamHelp text="Executes the configured ticks with the selected decision rule (heuristic, QRE, or LLM). Produces the history used by charts, tables, and replay—deterministic for heuristic/QRE at fixed seed." />
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                disabled={running || enqueueBusy || mode === "llm"}
                aria-busy={enqueueBusy}
                onClick={() => void onEnqueueRun()}
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[#1a1a1f] disabled:opacity-40"
              >
                <span className="inline-flex items-center gap-1.5">
                  {enqueueBusy ? (
                    <span
                      className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span>{enqueueBusy ? "Enqueueing…" : "Enqueue run"}</span>
                </span>
              </button>
              <ParamHelp text="Adds a single-run job to the local SQLite queue (heuristic or QRE). Requires a separate Node worker (pnpm sim:worker). Browser WASM heuristic is not used in the worker — runs use TypeScript @ip-sim/core policies." />
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              disabled={!run}
              onClick={downloadJson}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[#1a1a1f] disabled:opacity-40"
            >
              Download run JSON
            </button>
            <ParamHelp text="Exports the full serialized run (manifest, per-tick metrics, snapshots) for offline analysis or sharing—lossless relative to what the UI consumed." />
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 border-t border-[var(--border)] pt-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="min-w-0 text-[10px] text-[var(--muted)]">
            Save label (optional)
            <input
              className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px]"
              value={singleRunLabel}
              onChange={(e) => setSingleRunLabel(e.target.value)}
              placeholder="e.g. baseline"
            />
          </label>
          <button
            type="button"
            disabled={!run}
            onClick={saveSingleToProject}
            className="rounded-md bg-zinc-600 px-3 py-1.5 text-xs text-white hover:bg-zinc-500 disabled:opacity-40 sm:shrink-0"
          >
            Save run to project
          </button>
        </div>
            </div>
          ) : labTab === "grid" ? (
            <div className="space-y-4">
        {hydratedActive.gridSession ? (
          <div className="rounded-md border border-sky-900/45 bg-sky-950/25 px-2.5 py-1.5 text-[11px] text-sky-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">Currently running grid session</span>
                <span className="text-sky-200/85"> · {sessionProgressText(hydratedActive.gridSession)}</span>
              </span>
              <button
                type="button"
                className="rounded border border-sky-800/60 px-2 py-0.5 text-[10px] text-sky-50 hover:bg-sky-950/60"
                onClick={() => setLabTab("queue")}
              >
                Open Queue
              </button>
            </div>
          </div>
        ) : null}
        <BatchGridPanel
          baseConfig={config}
          mode={mode}
          qreTemp={qreTemp}
          onLoadRun={loadGridCell}
          onLabJobRunnerChange={onGridLabJobRunner}
          onSessionStarted={onGridSessionStarted}
          persistenceProjectId={selectedProjectId}
          onBatchFinished={onGridBatchFinished}
        />
        <section className="space-y-2 rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] px-3 py-2">
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Grid batches <strong className="font-medium text-[var(--text)]">auto-save</strong> each cell to SQLite (
            <code className="font-mono-n">data/sim-queue.db</code>, tables <code className="font-mono-n">lab_*</code>)
            and a metrics-only batch to the selected project (dual-write: DB is primary for full drill-down via API;
            project sidebar keeps compact cells for analytics chat).
          </p>
          {lastGridBatch && lastGridBatch.results.length > 0 ? (
            <p className="text-[10px] text-[var(--muted)]">
              Last finished grid: {lastGridBatch.results.length} cell(s) · {lastGridBatch.constructionLabel} ·{" "}
              {lastGridBatch.levelProductLabel}
            </p>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">Run a parameter grid batch to populate history.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[8rem] flex-1 text-[10px] text-[var(--muted)]">
              Batch label (optional)
              <input
                className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px]"
                value={analysisBatchName}
                onChange={(e) => setAnalysisBatchName(e.target.value)}
                placeholder="auto if empty"
              />
            </label>
            <button
              type="button"
              disabled={!lastGridBatch || lastGridBatch.results.length === 0}
              onClick={exportLastGridBatchJson}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[#1a1a1f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export last batch JSON
            </button>
          </div>
        </section>
            </div>
          ) : labTab === "optimize" ? (
            <div className="space-y-2">
        {hydratedActive.optimizationSession ? (
          <div className="rounded-md border border-sky-900/45 bg-sky-950/25 px-2.5 py-1.5 text-[11px] text-sky-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">Currently running optimization session</span>
                <span className="text-sky-200/85"> · {sessionProgressText(hydratedActive.optimizationSession)}</span>
              </span>
              <button
                type="button"
                className="rounded border border-sky-800/60 px-2 py-0.5 text-[10px] text-sky-50 hover:bg-sky-950/60"
                onClick={() => setLabTab("queue")}
              >
                Open Queue
              </button>
            </div>
          </div>
        ) : null}
        <OptimizationPanel
          baseConfig={config}
          mode={mode}
          qreTemp={qreTemp}
          onLoadBestRun={loadGridCell}
          onLabJobRunnerChange={onOptimizationLabJobRunner}
          onSessionStarted={onOptimizationSessionStarted}
          persistenceProjectId={selectedProjectId}
          onSessionCellsFinished={onOptimizationSessionFinished}
          activeOptimizationSession={hydratedActive.optimizationSession}
        />
        <section className="space-y-2 rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] px-3 py-2">
          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Each optimization trial <strong className="font-medium text-[var(--text)]">auto-saves</strong> to SQLite (
            <code className="font-mono-n">lab_trials</code>) with a compact run summary; full runs spill to{" "}
            <code className="font-mono-n">data/lab-exports/&lt;sessionId&gt;/</code> when large. A metrics-only batch
            is also written to the selected project (same dual-write pattern as the grid).
          </p>
          {lastOptimizationCells && lastOptimizationCells.length > 0 ? (
            <p className="text-[10px] text-[var(--muted)]">
              Last session: {lastOptimizationCells.length} trial(s) in memory (also on server if dev API is reachable).
            </p>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">Run optimization to record trials.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[8rem] flex-1 text-[10px] text-[var(--muted)]">
              Batch label (optional)
              <input
                className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px]"
                value={optimizationBatchName}
                onChange={(e) => setOptimizationBatchName(e.target.value)}
                placeholder="auto if empty"
              />
            </label>
            <button
              type="button"
              disabled={!lastOptimizationCells || lastOptimizationCells.length === 0}
              onClick={exportLastOptimizationJson}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[#1a1a1f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export trials JSON
            </button>
          </div>
        </section>
            </div>
          ) : null}
          {labTab === "queue" ? (
            <div className="block min-w-0" aria-hidden={false}>
              <SimQueuePanel />
            </div>
          ) : null}
        </div>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-3 overflow-x-hidden lg:basis-0 lg:shrink lg:grow-[1.1] lg:min-w-[min(100%,380px)] xl:min-w-[min(100%,420px)] lg:max-w-[min(100%,640px)]">
      <section className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 sm:p-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 className="min-w-0 text-sm font-medium sm:text-base">Network · topology at playhead (wealth-sized nodes)</h2>
          <span className="font-mono-n text-xs text-[var(--muted)]">
            tick {displayTick?.metrics.tick ?? "—"} / {run?.history.length ?? 0}
          </span>
        </div>
        <div ref={graphMeasureRef} className="w-full min-w-0 overflow-x-hidden">
        {run?.finalWorld && agentsAtTick && displayTick ? (
          <>
            <ForceGraph
              agents={agentsAtTick}
              edges={displayTick.edges}
              width={graphDims.width}
              height={graphDims.height}
              layoutSeed={config.seed}
              selectionResetEpoch={graphSelectionVersion}
              onSelectionChange={(ids) => setSelectedGraphNodeIds([...ids])}
            />
            <GraphLegend agents={agentsAtTick} />
            <GraphEvolutionExport
              run={run}
              finalAgents={run.finalWorld?.agents ?? null}
              layoutSeed={config.seed}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-n text-[11px] text-[var(--muted)]">
              <span>
                {selectedGraphNodeIds.length === 0
                  ? "No nodes selected."
                  : `${selectedGraphNodeIds.length} node${selectedGraphNodeIds.length === 1 ? "" : "s"} selected`}
              </span>
              <span className="text-[var(--border)]">·</span>
              <span>Click nodes to toggle membership (any count). Empty chart area or Esc clears.</span>
              <button
                type="button"
                disabled={selectedGraphNodeIds.length === 0}
                onClick={() => setGraphSelectionVersion((v) => v + 1)}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] hover:bg-[#1a1a1f] disabled:opacity-40"
              >
                Clear selection
              </button>
            </div>
            <ReplayToolbar
              disabled={!effectiveHistory.length}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              onReset={() => {
                setPlaying(false);
                setTickIndex(0);
              }}
              playbackTps={playbackTps}
              onPlaybackTps={setPlaybackTps}
              tickIndex={tickIndex}
              totalSteps={effectiveHistory.length}
              exporting={exportingVideo}
              exportingGif={exportingGif}
              onExportWebm={() => void exportWebm()}
              onExportGif={() => void exportGif()}
            />
            <div className="mt-3">
              <div className="mb-1 text-xs text-[var(--muted)]">
                <FieldLabel help="Jump to any historical tick to inspect network state and metrics at that moment without re-running the simulation.">
                  Scrub timeline
                </FieldLabel>
              </div>
              <input
                type="range"
                min={0}
                max={sliderMax}
                value={Math.min(tickIndex, sliderMax)}
                onChange={(e) => {
                  setPlaying(false);
                  setTickIndex(Number(e.target.value));
                }}
                className="mt-1 w-full"
              />
            </div>
          </>
        ) : (
          <div
            className="flex w-full min-w-0 items-center justify-center rounded border border-dashed border-[var(--border)] text-sm text-[var(--muted)]"
            style={{ minHeight: Math.max(220, graphDims.height) }}
          >
            Run a simulation to populate the collaboration graph.
          </div>
        )}
        </div>
      </section>

      <aside className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 sm:p-4">
        <h2 className="text-sm font-medium">Society metrics</h2>
        {displayTick ? (
          <dl className="grid min-w-0 grid-cols-2 gap-2 font-mono-n text-xs [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:text-end [&_dd]:tabular-nums">
            <dt className="text-[var(--muted)]">Total wealth</dt>
            <dd>{displayTick.metrics.totalWealth.toFixed(1)}</dd>
            <dt className="text-[var(--muted)]">Mean wealth / agent</dt>
            <dd title="Total wealth ÷ population (GDP-like level for comparing runs at different N)">
              {meanWealthAtTick(displayTick).toFixed(2)}
            </dd>
            <dt className="text-[var(--muted)]">Wealth · top 10% cohort</dt>
            <dd>{displayTick.metrics.top10Wealth.toFixed(1)}</dd>
            <dt className="text-[var(--muted)]">Wealth · top 1% cohort</dt>
            <dd>{displayTick.metrics.top1PercentWealth.toFixed(1)}</dd>
            <dt className="text-[var(--muted)]">Gini wealth</dt>
            <dd>{displayTick.metrics.giniWealth.toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Top 10% share</dt>
            <dd>{displayTick.metrics.top10WealthShare.toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Total reputation</dt>
            <dd>{reputationStockTotal(displayTick).toFixed(2)}</dd>
            <dt className="text-[var(--muted)]">Reputation · top 10% cohort</dt>
            <dd>{reputationTop10(displayTick).toFixed(2)}</dd>
            <dt className="text-[var(--muted)]">Reputation · top 1% cohort</dt>
            <dd>{reputationTop1(displayTick).toFixed(2)}</dd>
            <dt className="text-[var(--muted)]">Gini reputation</dt>
            <dd>{reputationGini(displayTick).toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Top 10% rep. share</dt>
            <dd>{reputationTop10Share(displayTick).toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Market HHI</dt>
            <dd>{displayTick.metrics.hhiMarketShare.toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Power HHI</dt>
            <dd>{displayTick.metrics.powerHHI.toFixed(3)}</dd>
            <dt className="text-[var(--muted)]">Innovation flow</dt>
            <dd>
              {Number.isFinite(innovationFlowAtTick(displayTick))
                ? innovationFlowAtTick(displayTick).toFixed(2)
                : "—"}
            </dd>
            <dt className="text-[var(--muted)]">Innovation / agent (norm.)</dt>
            <dd title="Innovation flow ÷ population (same scale idea as mean wealth / agent).">
              {Number.isFinite(innovationFlowPerAgentAtTick(displayTick))
                ? innovationFlowPerAgentAtTick(displayTick).toFixed(6)
                : "—"}
            </dd>
            <dt className="text-[var(--muted)]">Σ knowledge</dt>
            <dd>{displayTick.metrics.totalKnowledgeStock.toFixed(1)}</dd>
            <dt className="text-[var(--muted)]">Global pool</dt>
            <dd>{displayTick.metrics.globalPool.toFixed(2)}</dd>
            {(config.governance.enabled ||
              displayTick.metrics.civicPoliticianCount +
                displayTick.metrics.civicPublicServantFireableCount +
                displayTick.metrics.civicPublicServantTenuredCount >
                0) && (
              <>
                <dt className="text-[var(--muted)]">Civic · politicians</dt>
                <dd>{displayTick.metrics.civicPoliticianCount}</dd>
                <dt className="text-[var(--muted)]">Civic · servants (fireable)</dt>
                <dd>{displayTick.metrics.civicPublicServantFireableCount}</dd>
                <dt className="text-[var(--muted)]">Civic · servants (tenured)</dt>
                <dd>{displayTick.metrics.civicPublicServantTenuredCount}</dd>
                <dt className="text-[var(--muted)]">Civic · citizens</dt>
                <dd>{displayTick.metrics.civicCitizenCount}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted)]">No run yet.</p>
        )}

        <div className="min-w-0 border-t border-[var(--border)] pt-3">
          <h3 className="mb-2 text-xs font-medium text-[var(--muted)]">Time series</h3>
          {run?.history?.length ? (
            <MetricsCharts
              history={run.history}
              compareHistory={compareRun?.history}
              playheadStep={tickIndex}
            />
          ) : (
            <p className="text-xs text-[var(--muted)]">Charts appear after a run.</p>
          )}
        </div>
      </aside>
        </div>
      </div>
    </div>
  );
}
