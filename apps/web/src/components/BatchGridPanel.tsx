"use client";

import {
  qrePolicy,
  runSimulationSync,
  type AgentState,
  type SimConfig,
  type SimulationRun,
  type TickRecord,
  type WorldState,
} from "@ip-sim/core";
import { runSimulationHeuristicWasm } from "@/lib/rustHeuristicRun";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParamHelp } from "@/components/ParamHelp";
import {
  adaptAxisTableToFactorialCap,
  adaptAxisTableToOatSumCap,
  applyMultipleAxesToCell,
  autoSweepPointsPerAxis,
  buildGridConstructionPlan,
  cartesianAssignments,
  clampGridAxisStepCount,
  defaultCellManifest,
  DEFAULT_SAMPLE_RUN_COUNT,
  deriveDefaultNumericBounds,
  effectiveAxisSteps,
  estimateFullFactorialMaterializedBytes,
  formatAxisCellValue,
  getGridAxisDefinition,
  GRID_ABS_MAX_RUNS,
  GRID_AXIS_DEFINITIONS,
  GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES,
  GRID_MAX_STEPS_PER_AXIS,
  GRID_WARN_TOTAL_RUNS,
  sampleAxisValuesWithBounds,
  type GridAxisAssignment,
  type GridAxisId,
  type GridConstructionMode,
} from "@/lib/gridAxes";
import { totalAgents } from "@/lib/populationPresets";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import { hamiltonAllocateCountsFromWeights } from "@/lib/percentPopulation";
import { formatMachineHintsOneLine } from "@/lib/machineResourceHints";
import { useMachineResourceHints } from "@/lib/useMachineResourceHints";
import type { GridCellResult } from "@/lib/gridBatchTypes";
import {
  clearActiveLabJob,
  clearActiveLabJobIfId,
  getLabTabId,
  isGridProgress,
  LAB_JOB_HEARTBEAT_MS,
  newLabJobId,
  patchActiveLabJob,
  readActiveLabJob,
  setActiveLabJob,
  subscribeLabJobs,
} from "@/lib/labJobStore";
import {
  buildCompactRunSummaryJson,
  optionalFullRunJsonUnderCap,
  persistLabBatchCell,
  persistLabSessionComplete,
  persistLabSessionCreate,
} from "@/lib/labPersistenceClient";

export type { GridCellResult };

type AxisTableRow = {
  enabled: boolean;
  min: number;
  max: number;
  steps: number;
};

const GRID_CONSTRUCTION_LABELS: Record<GridConstructionMode, string> = {
  full_factorial: "Full factorial",
  random_sample: "Random sample (Monte Carlo)",
  latin_hypercube: "Latin hypercube",
  one_at_a_time: "One-at-a-time (OAT)",
};

function formatEstBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${Math.round(n)} B`;
}

const DEFAULT_ENABLED_AXES: ReadonlySet<GridAxisId> = new Set([
  "policy.enforcementIntensity",
  "policy.openScienceSubsidy",
]);

function buildAxisTableState(base: SimConfig): Record<GridAxisId, AxisTableRow> {
  const auto = autoSweepPointsPerAxis(base);
  const o = {} as Record<GridAxisId, AxisTableRow>;
  for (const d of GRID_AXIS_DEFINITIONS) {
    if (d.sweep.kind === "enum") {
      o[d.id] = {
        enabled: DEFAULT_ENABLED_AXES.has(d.id),
        min: 0,
        max: 0,
        steps: d.sweep.values.length,
      };
    } else {
      const b = deriveDefaultNumericBounds(d, base, auto);
      o[d.id] = {
        enabled: DEFAULT_ENABLED_AXES.has(d.id),
        min: b.min,
        max: b.max,
        steps: effectiveAxisSteps(d, auto),
      };
    }
  }
  return o;
}

type HeatmapMetricKey =
  | "giniWealth"
  | "innovationFlow"
  | "meanWealth"
  | "innovationFlowPerAgent";

function heatmapMetricValue(last: TickRecord, key: HeatmapMetricKey): number | null {
  const m = last.metrics;
  if (key === "giniWealth") return m.giniWealth;
  if (key === "innovationFlow") {
    const v = innovationFlowAtTick(last);
    return Number.isFinite(v) ? v : null;
  }
  if (key === "innovationFlowPerAgent") {
    const v = innovationFlowPerAgentAtTick(last);
    return Number.isFinite(v) ? v : null;
  }
  return meanWealthAtTick(last);
}

function heatmapCellDecimals(key: HeatmapMetricKey): number {
  if (key === "giniWealth") return 3;
  // Extra precision: small per-capita flows otherwise round to 0.0000 in the heatmap.
  if (key === "innovationFlowPerAgent") return 6;
  return 2;
}

export function BatchGridPanel(props: {
  baseConfig: SimConfig;
  mode: "heuristic" | "qre" | "llm";
  qreTemp: number;
  onLoadRun: (cell: GridCellResult) => void;
  /** Fires when a grid run finishes (complete or stopped) with the result rows. */
  onBatchFinished?: (
    results: GridCellResult[],
    meta: {
      sessionId: string | null;
      cancelled: boolean;
      gridConstruction: GridConstructionMode;
      constructionLabel: string;
      levelProductLabel: string;
    },
  ) => void;
  /** True while this panel is executing a batch (for cross-panel durable job UX). */
  onLabJobRunnerChange?: (active: boolean) => void;
  onSessionStarted?: (meta: {
    sessionId: string;
    gridConstruction: GridConstructionMode;
    constructionLabel: string;
    levelProductLabel: string;
  }) => void;
  /** Linked to analysis project for SQLite `lab_sessions.project_id` (optional). */
  persistenceProjectId?: string | null;
}) {
  const [axisTable, setAxisTable] = useState<Record<GridAxisId, AxisTableRow>>(() =>
    buildAxisTableState(props.baseConfig),
  );
  const [gridConstruction, setGridConstruction] = useState<GridConstructionMode>("full_factorial");
  const [sampleRunCount, setSampleRunCount] = useState(DEFAULT_SAMPLE_RUN_COUNT);
  /** When true (default), Random/LHS use the max-runs budget as N joint draws over all enabled axes. */
  const [sampleRunsTiedToMaxCap, setSampleRunsTiedToMaxCap] = useState(true);
  /** Full factorial only: Cartesian rows built on demand (see “Compute factorial grid”). */
  const [factorialSnapshot, setFactorialSnapshot] = useState<{
    key: string;
    assignments: GridAxisAssignment[][];
  } | null>(null);
  const [axesPanelOpen, setAxesPanelOpen] = useState(true);

  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetricKey>("giniWealth");
  const [running, setRunning] = useState(false);
  /** Set from “Stop batch”; read between simulations (current cell still finishes). */
  const batchCancelRequestedRef = useRef(false);
  const activeLabJobIdRef = useRef<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [, labJobUiBump] = useState(0);
  const [results, setResults] = useState<GridCellResult[]>([]);
  /** Last run: first two enabled axes (definition order) for 2D heatmap indexing. */
  const [gridShape, setGridShape] = useState<{
    axisAId: GridAxisId;
    axisBId: GridAxisId;
    aVals: (number | string)[];
    bVals: (number | string)[];
  } | null>(null);

  const [maxRunsInput, setMaxRunsInput] = useState(String(GRID_ABS_MAX_RUNS));
  const maxRunsUserCap = useMemo(() => {
    const v = parseInt(maxRunsInput.replace(/\s/g, ""), 10);
    if (!Number.isFinite(v)) return GRID_ABS_MAX_RUNS;
    return Math.min(GRID_ABS_MAX_RUNS, Math.max(1, v));
  }, [maxRunsInput]);

  const [maxAgentsInput, setMaxAgentsInput] = useState("");
  const maxAgentsCap = useMemo(() => {
    const t = maxAgentsInput.trim();
    if (t === "") return null;
    const v = parseInt(t, 10);
    if (!Number.isFinite(v) || v < 1) return null;
    return v;
  }, [maxAgentsInput]);

  const [fitMessage, setFitMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [plannedTotalAgentsStr, setPlannedTotalAgentsStr] = useState(() =>
    String(totalAgents(props.baseConfig.agentCounts)),
  );

  const machineHints = useMachineResourceHints();

  useEffect(() => {
    props.onLabJobRunnerChange?.(running);
  }, [running, props.onLabJobRunnerChange]);

  useEffect(() => subscribeLabJobs(() => labJobUiBump((n) => n + 1)), []);

  useEffect(() => {
    if (!running) return;
    const id = activeLabJobIdRef.current;
    if (!id) return;
    const t = window.setInterval(() => patchActiveLabJob(id, {}), LAB_JOB_HEARTBEAT_MS);
    return () => window.clearInterval(t);
  }, [running]);

  const interruptedGridJob = (() => {
    const j = readActiveLabJob();
    if (!j || j.status !== "running" || j.type !== "grid") return null;
    if (j.ownerTabId !== getLabTabId()) return null;
    if (running) return null;
    return j;
  })();

  const sidebarTotal = useMemo(
    () => totalAgents(props.baseConfig.agentCounts),
    [props.baseConfig.agentCounts],
  );

  const plannedGridN = useMemo(() => {
    const t = plannedTotalAgentsStr.trim();
    if (t === "") return sidebarTotal;
    const v = parseInt(t, 10);
    if (!Number.isFinite(v)) return sidebarTotal;
    return Math.max(0, v);
  }, [plannedTotalAgentsStr, sidebarTotal]);

  const gridCohortBase = useMemo(
    (): SimConfig => ({
      ...props.baseConfig,
      agentCounts: hamiltonAllocateCountsFromWeights(plannedGridN, props.baseConfig.agentCounts),
    }),
    [plannedGridN, props.baseConfig],
  );

  const autoSteps = useMemo(() => autoSweepPointsPerAxis(gridCohortBase), [gridCohortBase]);

  const enabledAxisIds = useMemo(() => {
    return GRID_AXIS_DEFINITIONS.map((d) => d.id).filter((id) => axisTable[id]!.enabled);
  }, [axisTable]);

  const sampleModesActive = gridConstruction === "random_sample" || gridConstruction === "latin_hypercube";

  const effectiveSampleRunCount = useMemo(() => {
    if (!sampleModesActive) return Math.max(1, Math.floor(sampleRunCount));
    if (sampleRunsTiedToMaxCap) return maxRunsUserCap;
    return Math.min(Math.max(1, Math.floor(sampleRunCount)), maxRunsUserCap);
  }, [maxRunsUserCap, sampleModesActive, sampleRunCount, sampleRunsTiedToMaxCap]);

  const runPlan = useMemo(() => {
    if (enabledAxisIds.length === 0) {
      return {
        specs: [],
        totalRuns: 0,
        assignments: [] as GridAxisAssignment[][],
        levelProductLabel: "—",
        heatmapEligible: false,
      };
    }
    return buildGridConstructionPlan({
      mode: gridConstruction,
      enabledAxisIds,
      axisTable,
      sampleRunCount: effectiveSampleRunCount,
      baseSeed: props.baseConfig.seed,
    });
  }, [axisTable, enabledAxisIds, effectiveSampleRunCount, gridConstruction, props.baseConfig.seed]);

  const plannedTotalRuns = enabledAxisIds.length === 0 ? 0 : runPlan.totalRuns;

  const fullFactorialPlanKey = useMemo(() => {
    if (gridConstruction !== "full_factorial") return "";
    return JSON.stringify(
      enabledAxisIds.map((id) => {
        const r = axisTable[id]!;
        return { id, min: r.min, max: r.max, steps: r.steps };
      }),
    );
  }, [axisTable, enabledAxisIds, gridConstruction]);

  useEffect(() => {
    if (gridConstruction !== "full_factorial") {
      setFactorialSnapshot(null);
      return;
    }
    setFactorialSnapshot((prev) => (prev && prev.key !== fullFactorialPlanKey ? null : prev));
  }, [fullFactorialPlanKey, gridConstruction]);

  const factorialRows = useMemo(() => {
    if (gridConstruction !== "full_factorial") return null;
    if (!factorialSnapshot || factorialSnapshot.key !== fullFactorialPlanKey) return null;
    return factorialSnapshot.assignments;
  }, [factorialSnapshot, fullFactorialPlanKey, gridConstruction]);

  const factorialMaterializeEstimate = useMemo(() => {
    if (gridConstruction !== "full_factorial" || plannedTotalRuns <= 0) return null;
    const axes = runPlan.specs.length;
    const bytes = estimateFullFactorialMaterializedBytes(plannedTotalRuns, axes);
    return {
      bytes,
      overHardBudget: bytes > GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES,
    };
  }, [gridConstruction, plannedTotalRuns, runPlan.specs.length]);

  const computeFactorialGridDisabled = useMemo(() => {
    if (gridConstruction !== "full_factorial") return true;
    if (plannedTotalRuns <= 0) return true;
    if (plannedTotalRuns > GRID_ABS_MAX_RUNS) return true;
    if (plannedTotalRuns > maxRunsUserCap) return true;
    if (factorialMaterializeEstimate?.overHardBudget) return true;
    if (factorialRows != null) return true;
    return false;
  }, [
    factorialMaterializeEstimate?.overHardBudget,
    factorialRows,
    gridConstruction,
    maxRunsUserCap,
    plannedTotalRuns,
  ]);

  const effectiveRunPlan = useMemo(() => {
    const previewTotal = runPlan.totalRuns;
    const specs = runPlan.specs;
    const sourceAssignments =
      gridConstruction === "full_factorial" ? (factorialRows ?? []) : runPlan.assignments;

    if (maxAgentsCap == null) {
      const totalRuns =
        gridConstruction === "full_factorial"
          ? factorialRows != null
            ? factorialRows.length
            : previewTotal
          : runPlan.totalRuns;
      return {
        specs,
        totalRuns,
        assignments: sourceAssignments,
        skippedByAgents: 0,
      };
    }

    if (sourceAssignments.length === 0) {
      return {
        specs,
        totalRuns: previewTotal,
        assignments: [],
        skippedByAgents: 0,
      };
    }

    const manifest0 = defaultCellManifest(props.mode, props.qreTemp);
    const kept: GridAxisAssignment[][] = [];
    let skippedByAgents = 0;
    for (const combo of sourceAssignments) {
      const { config } = applyMultipleAxesToCell(gridCohortBase, manifest0, combo);
      if (totalAgents(config.agentCounts) > maxAgentsCap) {
        skippedByAgents++;
        continue;
      }
      kept.push(combo);
    }
    return {
      specs,
      totalRuns: kept.length,
      assignments: kept,
      skippedByAgents,
    };
  }, [
    factorialRows,
    gridConstruction,
    gridCohortBase,
    maxAgentsCap,
    props.mode,
    props.qreTemp,
    runPlan.assignments,
    runPlan.specs,
    runPlan.totalRuns,
  ]);

  const plannedSimsAfterAgentCap = effectiveRunPlan.totalRuns;
  const heatmapDisabledByAgentFilter =
    maxAgentsCap != null && effectiveRunPlan.skippedByAgents > 0;

  const applyFitToMaxRuns = useCallback(() => {
    if (gridConstruction === "random_sample" || gridConstruction === "latin_hypercube") {
      if (sampleRunsTiedToMaxCap) {
        setFitMessage({
          kind: "ok",
          text: `Random/LHS already runs ${maxRunsUserCap.toLocaleString("en-US")} joint draws (max runs cap). Turn off “Use max runs as sample size” to edit “Sample runs” manually, then Fit can clamp it.`,
        });
        return;
      }
      setSampleRunCount((s) => Math.min(Math.max(1, Math.floor(s)), maxRunsUserCap));
      setFitMessage({
        kind: "ok",
        text: `Sample runs clamped to ≤ ${maxRunsUserCap.toLocaleString("en-US")} (max runs cap).`,
      });
      return;
    }
    if (gridConstruction === "one_at_a_time") {
      setAxisTable((prev) => {
        const enabled = GRID_AXIS_DEFINITIONS.map((d) => d.id).filter((id) => prev[id]!.enabled);
        const r = adaptAxisTableToOatSumCap(prev, enabled, maxRunsUserCap);
        if (!r.ok) {
          setFitMessage({ kind: "error", text: r.message ?? "Could not fit OAT sum under cap." });
        } else if (r.sumBefore > r.sumAfter) {
          setFitMessage({
            kind: "ok",
            text: `OAT sum ${r.sumBefore.toLocaleString("en-US")} → ${r.sumAfter.toLocaleString("en-US")} runs (≤ ${maxRunsUserCap.toLocaleString("en-US")}).`,
          });
        } else {
          setFitMessage(null);
        }
        return r.table;
      });
      return;
    }
    setAxisTable((prev) => {
      const enabled = GRID_AXIS_DEFINITIONS.map((d) => d.id).filter((id) => prev[id]!.enabled);
      const r = adaptAxisTableToFactorialCap(prev, enabled, gridCohortBase, maxRunsUserCap);
      if (!r.ok) {
        setFitMessage({ kind: "error", text: r.message ?? "Could not fit factorial under cap." });
      } else if (r.productBefore > r.productAfter) {
        setFitMessage({
          kind: "ok",
          text: `Adjusted resolution: ${r.productBefore.toLocaleString("en-US")} → ${r.productAfter.toLocaleString(
            "en-US",
          )} sims (≤ ${maxRunsUserCap.toLocaleString("en-US")} max runs).`,
        });
      } else {
        setFitMessage(null);
      }
      return r.table;
    });
  }, [gridCohortBase, gridConstruction, maxRunsUserCap, sampleRunsTiedToMaxCap]);

  const computeFactorialGrid = useCallback(() => {
    if (gridConstruction !== "full_factorial") return;
    const specs = runPlan.specs;
    const rows = runPlan.totalRuns;
    if (rows <= 0) {
      alert("Nothing to materialize — enable axes with at least one level each.");
      return;
    }
    if (rows > GRID_ABS_MAX_RUNS) {
      alert(
        `This factorial has ${rows.toLocaleString("en-US")} rows (absolute cap ${GRID_ABS_MAX_RUNS.toLocaleString("en-US")}). Reduce axes, bounds, or steps first.`,
      );
      return;
    }
    if (rows > maxRunsUserCap) {
      alert(
        `Factorial product ${rows.toLocaleString("en-US")} exceeds your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Use “Fit to max runs now” or reduce steps before materializing.`,
      );
      return;
    }
    const est = estimateFullFactorialMaterializedBytes(rows, specs.length);
    if (est > GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES) {
      alert(
        `Conservative heap estimate for this grid (~${formatEstBytes(est)}) exceeds the browser safety budget (~${formatEstBytes(GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES)}). Use fewer axes or steps, then try again.`,
      );
      return;
    }
    const ok = window.confirm(
      `Materialize the full factorial in memory: ${rows.toLocaleString("en-US")} rows × ${specs.length} axes (~${formatEstBytes(est)} estimated heap). The tab may pause for several seconds. Continue?`,
    );
    if (!ok) return;
    try {
      const assignments = cartesianAssignments(specs);
      setFactorialSnapshot({ key: fullFactorialPlanKey, assignments });
    } catch {
      alert(
        "Failed to build the factorial grid (likely out of memory). Reduce design size and try again.",
      );
    }
  }, [
    fullFactorialPlanKey,
    gridConstruction,
    maxRunsUserCap,
    runPlan.specs,
    runPlan.totalRuns,
  ]);

  const skipFirstFitEffectRef = useRef(true);
  useEffect(() => {
    if (gridConstruction !== "full_factorial") return;
    if (skipFirstFitEffectRef.current) {
      skipFirstFitEffectRef.current = false;
      return;
    }
    const h = setTimeout(() => applyFitToMaxRuns(), 450);
    return () => clearTimeout(h);
  }, [maxRunsUserCap, applyFitToMaxRuns, gridConstruction]);

  const levelProductLabel = runPlan.levelProductLabel;

  const onBatchFinished = props.onBatchFinished;
  const prevRunningRef = useRef(false);
  const lastSessionMetaRef = useRef<{ id: string; cancelled: boolean } | null>(null);
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      onBatchFinished?.(results, {
        sessionId: lastSessionMetaRef.current?.id ?? null,
        cancelled: Boolean(lastSessionMetaRef.current?.cancelled),
        gridConstruction,
        constructionLabel: GRID_CONSTRUCTION_LABELS[gridConstruction],
        levelProductLabel,
      });
    }
    prevRunningRef.current = running;
  }, [running, results, gridConstruction, levelProductLabel, onBatchFinished]);

  const runBlockReason = useMemo((): string | null => {
    if (props.mode === "llm") {
      return "Switch to Heuristic or QRE — LLM batches are not supported.";
    }
    if (running) return null;
    if (enabledAxisIds.length === 0) {
      return "Enable at least one axis in the sweep table.";
    }
    if (plannedTotalRuns === 0) {
      return "No simulations to run.";
    }
    if (plannedTotalRuns > GRID_ABS_MAX_RUNS) {
      return `Over absolute max (${GRID_ABS_MAX_RUNS.toLocaleString("en-US")}). Fewer axes, tighter bounds, or fewer steps per axis.`;
    }
    if (plannedTotalRuns > maxRunsUserCap) {
      if (gridConstruction === "full_factorial") {
        return `Factorial product exceeds your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Lower steps, disable axes, or use “Fit to max runs now”.`;
      }
      if (gridConstruction === "one_at_a_time") {
        return `OAT sum (${plannedTotalRuns.toLocaleString("en-US")} runs) exceeds your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Lower per-axis steps, disable axes, or use “Fit to max runs now”.`;
      }
      return `Sample runs exceed your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Turn off “Use max runs as sample size” and lower “Sample runs”, or raise the cap.`;
    }
    if (gridConstruction === "full_factorial" && plannedTotalRuns > 0 && factorialRows == null) {
      return "Materialize the factorial grid with “Compute factorial grid” before running.";
    }
    if (maxAgentsCap != null && plannedSimsAfterAgentCap === 0 && plannedTotalRuns > 0) {
      return `Max agents cap (${maxAgentsCap.toLocaleString("en-US")}): every batch point exceeds initial cohort N (Σ counts). Widen the cap or narrow population axes.`;
    }
    return null;
  }, [
    enabledAxisIds.length,
    factorialRows,
    maxAgentsCap,
    maxRunsUserCap,
    plannedSimsAfterAgentCap,
    plannedTotalRuns,
    gridConstruction,
    props.mode,
    running,
  ]);

  const runButtonDisabled = running || runBlockReason !== null;

  const resultsTableColSpan = 1 + enabledAxisIds.length + 5;

  const maxAgentsRef = useMemo(
    () => Math.max(totalAgents(gridCohortBase.agentCounts), props.baseConfig.spawn.maxAgents),
    [gridCohortBase.agentCounts, props.baseConfig.spawn.maxAgents],
  );

  const syncBoundsFromSidebar = useCallback(() => {
    setAxisTable(buildAxisTableState(props.baseConfig));
  }, [props.baseConfig]);

  const runGrid = useCallback(async () => {
    if (props.mode === "llm") {
      alert("Grid batch supports heuristic or QRE only (fast local policies).");
      return;
    }
    if (enabledAxisIds.length === 0) {
      alert("Enable at least one sweep parameter (checkboxes in the axes table).");
      return;
    }

    const { specs, totalRuns, assignments } = effectiveRunPlan;

    if (totalRuns === 0) {
      alert("No simulations to run after applying the max agents cap.");
      return;
    }

    if (plannedTotalRuns > GRID_ABS_MAX_RUNS) {
      alert(
        `This batch would run ${plannedTotalRuns.toLocaleString("en-US")} simulations (absolute cap ${GRID_ABS_MAX_RUNS.toLocaleString("en-US")}). ` +
          `Reduce design size (axes, bounds, steps, construction mode, or sample runs), then try again.`,
      );
      return;
    }

    if (plannedTotalRuns > maxRunsUserCap) {
      alert(
        gridConstruction === "full_factorial"
          ? `Factorial product ${plannedTotalRuns.toLocaleString("en-US")} exceeds your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Use “Fit to max runs now” or reduce steps.`
          : gridConstruction === "one_at_a_time"
            ? `OAT sum ${plannedTotalRuns.toLocaleString("en-US")} exceeds your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Use “Fit to max runs now” or reduce per-axis steps.`
            : `Planned runs ${plannedTotalRuns.toLocaleString("en-US")} exceed your max runs cap (${maxRunsUserCap.toLocaleString("en-US")}). Lower sample runs or raise the cap.`,
      );
      return;
    }

    if (gridConstruction === "full_factorial" && assignments.length === 0 && plannedTotalRuns > 0) {
      alert("Materialize the factorial grid first (“Compute factorial grid” in Run plan).");
      return;
    }

    if (totalRuns > GRID_WARN_TOTAL_RUNS) {
      const ok = window.confirm(
        `This batch will run ${totalRuns.toLocaleString("en-US")} simulations (${GRID_CONSTRUCTION_LABELS[gridConstruction]} · ${levelProductLabel}). ` +
          `It may take a long time or freeze the tab. Continue?`,
      );
      if (!ok) return;
    }

    setResults([]);
    const canHeatmap =
      runPlan.heatmapEligible &&
      !heatmapDisabledByAgentFilter &&
      maxAgentsCap == null;
    if (canHeatmap) {
      const aSpec = specs[0]!;
      const bSpec = specs[1]!;
      setGridShape({
        axisAId: aSpec.id,
        axisBId: bSpec.id,
        aVals: aSpec.values,
        bVals: bSpec.values,
      });
    } else {
      setGridShape(null);
    }

    const out: GridCellResult[] = [];
    const jobId = newLabJobId();
    lastSessionMetaRef.current = { id: jobId, cancelled: false };
    props.onSessionStarted?.({
      sessionId: jobId,
      gridConstruction,
      constructionLabel: GRID_CONSTRUCTION_LABELS[gridConstruction],
      levelProductLabel,
    });
    activeLabJobIdRef.current = jobId;
    void persistLabSessionCreate({
      id: jobId,
      sessionType: "grid_batch",
      projectId: props.persistenceProjectId ?? null,
      meta: {
        label: GRID_CONSTRUCTION_LABELS[gridConstruction],
        gridConstruction,
        levelProductLabel,
        plannedTotalRuns,
        runnableTotal: totalRuns,
        maxRunsUserCap,
        maxAgentsCap: maxAgentsCap ?? null,
        plannedGridN,
        baseSeed: props.baseConfig.seed,
        mode: props.mode,
        qreTemp: props.qreTemp,
        enabledAxisIds,
      },
    });
    setActiveLabJob({
      id: jobId,
      type: "grid",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
      label: `Grid · ${GRID_CONSTRUCTION_LABELS[gridConstruction]}`,
      progress: { done: 0, total: totalRuns },
      ownerTabId: getLabTabId(),
      payload: { gridConstruction },
    });
    setRunning(true);
    batchCancelRequestedRef.current = false;
    setProgress({ done: 0, total: totalRuns });
    const manifest0 = defaultCellManifest(props.mode, props.qreTemp);
    let completedAllCells = false;

    try {
      for (let idx = 0; idx < assignments.length; idx++) {
        if (batchCancelRequestedRef.current) {
          break;
        }
        const combo = assignments[idx]!;
        let { config: cfg, manifest } = applyMultipleAxesToCell(gridCohortBase, manifest0, combo);
        if (maxAgentsCap != null) {
          cfg = {
            ...cfg,
            spawn: { ...cfg.spawn, maxAgents: Math.min(cfg.spawn.maxAgents, maxAgentsCap) },
          };
        }

        const result =
          manifest.policyMode === "heuristic"
            ? await runSimulationHeuristicWasm(cfg)
            : runSimulationSync({
                config: cfg,
                manifest: {
                  seed: cfg.seed,
                  policyMode: "qre",
                  qreTemperature: manifest.qreTemperature,
                },
                decide: (w: WorldState, agent: AgentState) =>
                  qrePolicy(agent, w, {
                    temperature: manifest.qreTemperature,
                    seedSalt: cfg.seed,
                  }),
              });

        const labelParts = combo.map((a: GridAxisAssignment) => {
          const def = getGridAxisDefinition(a.id);
          return `${def.short} ${formatAxisCellValue(a.value)}`;
        });
        const cellN = totalAgents(cfg.agentCounts);
        const nHint = cellN !== plannedGridN ? ` · N=${cellN}` : "";
        const id = `g${idx}_${combo.map((c: GridAxisAssignment) => `${c.id}:${formatAxisCellValue(c.value)}`).join("_")}`;

        const cellResult: GridCellResult = {
          id,
          label: `${labelParts.join(" · ")}${nHint}`,
          assignments: combo,
          run: result,
        };
        out.push(cellResult);
        void persistLabBatchCell({
          sessionId: jobId,
          rowId: id,
          cellIndex: idx,
          cellClientId: id,
          label: cellResult.label,
          assignments: combo,
          runSummaryJson: buildCompactRunSummaryJson(result),
          fullRunJson: optionalFullRunJsonUnderCap(result),
        });
        setProgress({ done: idx + 1, total: totalRuns });
        patchActiveLabJob(jobId, { progress: { done: idx + 1, total: totalRuns } });
        setResults([...out]);
        await new Promise((r) => setTimeout(r, 0));
      }
      completedAllCells = !batchCancelRequestedRef.current && out.length === assignments.length;
    } finally {
      if (lastSessionMetaRef.current?.id === jobId) {
        lastSessionMetaRef.current = { id: jobId, cancelled: !completedAllCells };
      }
      batchCancelRequestedRef.current = false;
      const jid = activeLabJobIdRef.current;
      activeLabJobIdRef.current = null;
      if (jid) {
        void persistLabSessionComplete({
          sessionId: jid,
          status: completedAllCells ? "complete" : "cancelled",
        });
        clearActiveLabJobIfId(jid);
      }
      setRunning(false);
    }
  }, [
    effectiveRunPlan,
    enabledAxisIds,
    gridConstruction,
    heatmapDisabledByAgentFilter,
    levelProductLabel,
    runPlan.heatmapEligible,
    maxAgentsCap,
    maxRunsUserCap,
    plannedTotalRuns,
    gridCohortBase,
    plannedGridN,
    props.mode,
    props.qreTemp,
    props.persistenceProjectId,
  ]);

  const heatmapData = useMemo(() => {
    if (!gridShape || enabledAxisIds.length !== 2) return null;
    const rows = gridShape.aVals.length;
    const cols = gridShape.bVals.length;
    const cells = Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) => {
        const idx = i * cols + j;
        const r = results[idx];
        if (!r) return { idx, value: null as number | null };
        const last = r.run.history[r.run.history.length - 1];
        const v = last ? heatmapMetricValue(last, heatmapMetric) : null;
        return { idx, value: v ?? null };
      }),
    );
    return {
      axisAId: gridShape.axisAId,
      axisBId: gridShape.axisBId,
      aVals: gridShape.aVals,
      bVals: gridShape.bVals,
      cells,
    };
  }, [enabledAxisIds.length, gridShape, results, heatmapMetric]);

  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] p-3 sm:p-4">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold tracking-tight text-[var(--text)]">
          <span>Parameter grid</span>
          <span className="text-[11px] font-normal text-[var(--muted)]">
            · {GRID_CONSTRUCTION_LABELS[gridConstruction].toLowerCase()}
          </span>
          <ParamHelp text="Choose how points in parameter space are built. Full factorial: Cartesian product of per-axis levels (classic screening grid). Random sample: N independent uniform draws in numeric bounds / discrete levels (Monte Carlo). Latin hypercube: stratified projections (McKay et al. 1979) — Steps set discrete resolution along each axis but draws are continuous in the box between min/max (ints rounded). One-at-a-time: axial paths — baseline at midpoint level per axis, sweep one axis at a time (Morris-style local screening, simplified). Heatmap only for full factorial with exactly two axes. Uses Run sidebar as baseline; deterministic draws use Run seed + mode + run index. LLM mode cannot batch." />
        </div>
        <p className="flex flex-wrap items-center gap-1 text-[11px] leading-relaxed text-[var(--muted)]">
          <span>
            Run sidebar cohort{" "}
            <span className="font-mono-n text-[var(--text)]">N={sidebarTotal.toLocaleString("en-US")}</span>
            {plannedGridN !== sidebarTotal ? (
              <>
                {" · "}
                grid uses{" "}
                <span className="font-mono-n text-[var(--text)]">N={plannedGridN.toLocaleString("en-US")}</span>
              </>
            ) : null}
            {". "}
            &gt;{GRID_WARN_TOTAL_RUNS.toLocaleString("en-US")} runs → confirm; &gt;
            {GRID_ABS_MAX_RUNS.toLocaleString("en-US")} → blocked.
          </span>
          <ParamHelp
            text={`Full factorial: total = product of per-axis levels. Random / Latin hypercube: total = sample runs (also clamped to max runs cap). OAT: total = sum of per-axis level counts. Above ${GRID_WARN_TOTAL_RUNS.toLocaleString(
              "en-US",
            )} runnable sims you must confirm because the tab may stall. ${GRID_ABS_MAX_RUNS.toLocaleString(
              "en-US",
            )} is the absolute ceiling; use “Max runs” below as a budget with “Fit to max runs now”.`}
          />
        </p>
        <p className="flex flex-wrap items-center gap-1 font-mono-n text-[10px] leading-snug text-[var(--muted)]">
          <span>{formatMachineHintsOneLine(machineHints)}</span>
          <ParamHelp text="navigator.hardwareConcurrency is a logical processor hint for this page (not an OS reservation). performance.memory.jsHeapSizeLimit exists mainly on Chromium and caps the JS heap for this renderer—not total machine RAM. Safari/Firefox usually omit heap stats." />
        </p>
        <p className="flex flex-wrap items-center gap-1 text-[10px] leading-snug text-[var(--muted)]">
          <span>
            Execution: one simulation at a time on the main thread (sequential cells). WASM heuristic runs use a
            single in-flight call per cell—no Web Worker pool, so do not assume all logical cores are used.
          </span>
          <ParamHelp text="The batch loop awaits each run before starting the next. Parallelism would require explicit Web Workers or WASM with threads and a matching host API; that is not part of BatchGridPanel today." />
        </p>
      </header>

      {interruptedGridJob ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/55 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100"
          role="status"
        >
          <span>
            <span className="font-medium">Previous grid batch interrupted</span>
            {isGridProgress(interruptedGridJob.progress) ? (
              <span className="text-amber-100/85">
                {" "}
                · last progress {interruptedGridJob.progress.done.toLocaleString("en-US")} /{" "}
                {interruptedGridJob.progress.total.toLocaleString("en-US")} cells (reload stops the batch loop).
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="shrink-0 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800/80"
            onClick={() => clearActiveLabJob()}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <details
        open={axesPanelOpen}
        onToggle={(e) => setAxesPanelOpen((e.target as HTMLDetailsElement).open)}
        className="overflow-hidden rounded-lg border border-[var(--border)] bg-[#101014]"
      >
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-[var(--text)] marker:content-none hover:bg-[#16161c] [&::-webkit-details-marker]:hidden">
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className="text-[var(--muted)]">Sweep axes</span>
            <span
              className="inline-flex shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <ParamHelp text="Parameters you enable here are swept in a full factorial against the current Run sidebar baseline. Default points-per-axis scales down when cohort N or spawn cap is large, to keep factorial size tractable." />
            </span>
            <span className="text-[var(--text)]">
              {enabledAxisIds.length} on · ref N,cap={maxAgentsRef.toLocaleString("en-US")} → {autoSteps} pts/axis
              default
            </span>
          </span>
        </summary>
        <div className="space-y-3 border-t border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
                onClick={syncBoundsFromSidebar}
              >
                Reset from sidebar
              </button>
              <ParamHelp text="Recompute min, max, and default step counts from the current Run configuration (same logic as when the grid first loaded). Use after changing population, ticks, innovation sliders, or other sidebar fields you want reflected in the sweep bounds." />
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
                onClick={() =>
                  setAxisTable((prev) => {
                    const next = { ...prev };
                    for (const d of GRID_AXIS_DEFINITIONS) {
                      next[d.id] = { ...next[d.id]!, enabled: true };
                    }
                    return next;
                  })
                }
              >
                Select all axes
              </button>
              <ParamHelp text="Enables every row in the sweep table (same as “select all variables”). The factorial can explode—set max runs and use Fit to max runs if needed." />
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-[#1a1a1f] hover:text-[var(--text)]"
                onClick={() =>
                  setAxisTable((prev) => {
                    const next = { ...prev };
                    for (const d of GRID_AXIS_DEFINITIONS) {
                      next[d.id] = { ...next[d.id]!, enabled: false };
                    }
                    return next;
                  })
                }
              >
                Disable all
              </button>
              <ParamHelp text="Unchecks every sweep row. Use before enabling only the axes you care about, or to recover from an oversized factorial selection." />
            </span>
            <span className="inline-flex min-w-0 flex-wrap items-center gap-1 text-[10px] leading-snug text-[var(--muted)]">
              <span>
                Min/max follow sidebar sweep logic. Steps 2–{GRID_MAX_STEPS_PER_AXIS} per numeric axis; enums use all
                levels.
              </span>
              <ParamHelp text="Numeric axes sample evenly between min and max with the step count you set (clamped 2–48). Enumeration axes always include every discrete level when the row is on." />
            </span>
          </div>
          <div className="-mx-0.5 max-h-[min(50vh,420px)] overflow-auto rounded border border-[var(--border)] bg-[#08080a] sm:mx-0">
            <table className="w-max min-w-full border-collapse text-left font-mono-n text-[10px] sm:w-full">
              <thead className="sticky top-0 z-[2] border-b border-[var(--border)] bg-[#141418] text-[var(--muted)] shadow-[0_1px_0_rgba(0,0,0,0.35)]">
                <tr>
                  <th className="whitespace-nowrap p-1.5 text-left">
                    <span className="inline-flex items-center gap-0.5">
                      On
                      <ParamHelp text="When checked, this axis participates in the factorial; its sampled values replace the sidebar value in each cell. When off, the sidebar value is fixed for all cells." />
                    </span>
                  </th>
                  <th className="min-w-[8rem] p-1.5 text-left sm:min-w-[10rem]">
                    <span className="inline-flex items-center gap-0.5">
                      Parameter
                      <ParamHelp text="SimConfig or batch-manifest field (see label and category). Hover the parameter name or ⓘ for a native tooltip describing what that axis changes." />
                    </span>
                  </th>
                  <th className="w-[5.25rem] whitespace-nowrap p-1.5 text-right tabular-nums">
                    <span className="inline-flex w-full items-center justify-end gap-0.5">
                      Min
                      <ParamHelp text="Lower inclusive bound for numeric sweeps. Ignored for enumeration axes (shown as —). If min and max are reversed, the runner sorts them." />
                    </span>
                  </th>
                  <th className="w-[5.25rem] whitespace-nowrap p-1.5 text-right tabular-nums">
                    <span className="inline-flex w-full items-center justify-end gap-0.5">
                      Max
                      <ParamHelp text="Upper inclusive bound for numeric sweeps. Ignored for enumeration axes." />
                    </span>
                  </th>
                  <th className="w-[4.5rem] whitespace-nowrap p-1.5 text-right tabular-nums">
                    <span className="inline-flex w-full items-center justify-end gap-0.5">
                      Steps
                      <ParamHelp
                        text={
                          sampleModesActive
                            ? "Full factorial: same as below. Random / LHS: Steps set how many discrete reference levels we build per axis (enums may subsample); continuous draws still use the full min–max interval with rounding for integers."
                            : "Numeric axes: evenly spaced sample count between min and max (2–48). Enum axes show level count; auto-fit under max runs may subsample to fewer evenly spaced levels."
                        }
                      />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {GRID_AXIS_DEFINITIONS.map((d) => {
                  const row = axisTable[d.id]!;
                  const isEnum = d.sweep.kind === "enum";
                  const enumLen = d.sweep.kind === "enum" ? d.sweep.values.length : 0;
                  return (
                    <tr key={d.id} className="border-t border-[var(--border)] hover:bg-[#121216]">
                      <td className="p-1.5 align-middle">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) =>
                            setAxisTable((prev) => ({
                              ...prev,
                              [d.id]: { ...prev[d.id]!, enabled: e.target.checked },
                            }))
                          }
                          className="accent-zinc-500"
                        />
                      </td>
                      <td className="max-w-[12rem] p-1.5 align-middle text-[var(--text)] sm:max-w-none">
                        <div className="min-w-0">
                          <div className="inline-flex max-w-full items-baseline gap-0.5">
                            <span className="truncate font-medium sm:whitespace-normal">{d.label}</span>
                            <ParamHelp text={d.description} />
                          </div>
                          <span className="block truncate text-[9px] text-[var(--muted)]" title={d.category}>
                            {d.category}
                          </span>
                        </div>
                      </td>
                      <td className="p-1.5 align-middle text-right tabular-nums">
                        {isEnum ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <input
                            type="number"
                            step="any"
                            disabled={!row.enabled}
                            className="w-full max-w-[5rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-1.5 py-0.5 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
                            value={row.min}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setAxisTable((prev) => ({
                                ...prev,
                                [d.id]: { ...prev[d.id]!, min: Number.isFinite(v) ? v : prev[d.id]!.min },
                              }));
                            }}
                          />
                        )}
                      </td>
                      <td className="p-1.5 align-middle text-right tabular-nums">
                        {isEnum ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <input
                            type="number"
                            step="any"
                            disabled={!row.enabled}
                            className="w-full max-w-[5rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-1.5 py-0.5 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
                            value={row.max}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              setAxisTable((prev) => ({
                                ...prev,
                                [d.id]: { ...prev[d.id]!, max: Number.isFinite(v) ? v : prev[d.id]!.max },
                              }));
                            }}
                          />
                        )}
                      </td>
                      <td className="p-1.5 align-middle text-right tabular-nums">
                        {isEnum ? (
                          <span className="inline-flex items-center justify-end gap-0.5 text-[var(--muted)]">
                            <span
                              title={
                                row.steps >= enumLen
                                  ? "All discrete levels when this row is on"
                                  : "Subsampled levels for factorial size (auto-fit)"
                              }
                            >
                              {row.steps >= enumLen ? `${enumLen} lv` : `${row.steps}/${enumLen} lv`}
                            </span>
                            <ParamHelp
                              text={
                                row.steps >= enumLen
                                  ? "Enumeration axes use every listed level when the row is on. If auto-fit lowers the level count, values are evenly subsampled from the list."
                                  : "Fewer than the full enum count: levels are evenly subsampled from the full list so the factorial fits under max runs."
                              }
                            />
                          </span>
                        ) : (
                          <input
                            type="number"
                            min={2}
                            max={GRID_MAX_STEPS_PER_AXIS}
                            step={1}
                            disabled={!row.enabled}
                            className="ml-auto block w-[3.25rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-1.5 py-0.5 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-40"
                            value={row.steps}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              setAxisTable((prev) => ({
                                ...prev,
                                [d.id]: {
                                  ...prev[d.id]!,
                                  steps: Number.isFinite(v)
                                    ? clampGridAxisStepCount(v)
                                    : prev[d.id]!.steps,
                                },
                              }));
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <section
        className="space-y-2 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-3 py-2.5"
        aria-label="Grid construction"
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Grid construction</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[11rem] max-w-full flex-col gap-0.5 text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              Method
              <ParamHelp text="How batch points are chosen. Full factorial, Random, and Latin hypercube each use every enabled axis together on every simulation (joint parameter vector). OAT (one-at-a-time) is different by design: it walks one axis through its levels while the others stay at a mid-level baseline—cheap screening, not joint coverage of all axes per run. Full factorial: Cartesian product of discrete levels. Random: Monte Carlo uniform in numeric bounds / discrete levels. LHS: stratified unit intervals per axis (McKay et al. 1979), row shuffle. For Random/LHS, leave “Use max runs cap as sample size” on so the batch count follows your max-runs budget instead of the separate 120 default." />
            </span>
            <select
              id="batch-grid-construction"
              className="max-w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-[11px] text-[var(--text)]"
              value={gridConstruction}
              onChange={(e) => setGridConstruction(e.target.value as GridConstructionMode)}
            >
              <option value="full_factorial">Full factorial</option>
              <option value="random_sample">Random sample (Monte Carlo)</option>
              <option value="latin_hypercube">Latin hypercube</option>
              <option value="one_at_a_time">One-at-a-time (OAT)</option>
            </select>
          </label>
          {sampleModesActive ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
              <label className="inline-flex max-w-full cursor-pointer items-center gap-2 text-[10px] text-[var(--text)]">
                <input
                  type="checkbox"
                  className="accent-zinc-500"
                  checked={sampleRunsTiedToMaxCap}
                  onChange={(e) => setSampleRunsTiedToMaxCap(e.target.checked)}
                />
                <span className="inline-flex flex-wrap items-center gap-0.5 leading-snug">
                  Use max runs cap as sample size
                  <ParamHelp text="When checked, Random and Latin hypercube run exactly as many simulations as your Max runs (budget)—each run draws values for all enabled axes at once (joint Monte Carlo or LHS). When unchecked, use the number below instead (still capped by max runs and the absolute ceiling). Default is on so raising the budget increases batch size instead of staying at 120." />
                </span>
              </label>
              <label className="flex min-w-[8rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
                <span className="inline-flex items-center gap-0.5">
                  Sample runs
                  <ParamHelp text="Only used when “Use max runs cap as sample size” is off. Each run still varies every enabled axis jointly. Clamped to max runs cap. Deterministic RNG uses the Run seed plus mode and run index." />
                </span>
                <input
                  type="number"
                  min={1}
                  max={GRID_ABS_MAX_RUNS}
                  disabled={sampleRunsTiedToMaxCap}
                  className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] tabular-nums text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                  value={sampleRunCount}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setSampleRunCount(Number.isFinite(v) ? Math.min(GRID_ABS_MAX_RUNS, Math.max(1, v)) : 1);
                  }}
                />
                {sampleRunsTiedToMaxCap ? (
                  <span className="text-[9px] leading-tight text-[var(--muted)]">
                    Effective{" "}
                    <span className="font-mono-n text-[var(--text)]">
                      {effectiveSampleRunCount.toLocaleString("en-US")}
                    </span>{" "}
                    = max runs cap (joint draws)
                  </span>
                ) : sampleRunCount > maxRunsUserCap ? (
                  <span className="text-[9px] leading-tight text-amber-100/85">
                    Effective {effectiveSampleRunCount.toLocaleString("en-US")} (≤ max runs cap)
                  </span>
                ) : null}
              </label>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className="space-y-2 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-3 py-2.5"
        aria-label="Grid batch caps"
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Batch caps</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[8.5rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              Planned total N (cohort)
              <ParamHelp text="Integer headcount for the initial population in every grid cell before sweep axes are applied. Counts are derived from your Run configuration mix using Hamilton (largest remainder) at this N, matching the Run sidebar percentage logic. This overrides the Run sidebar total for the batch only unless you sync again. Any sweep row that patches agentCounts.bigco / academic / smb / solo still replaces that cohort count after rescaling." />
            </span>
            <input
              type="number"
              min={0}
              step={1}
              className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] tabular-nums text-[var(--text)]"
              value={plannedTotalAgentsStr}
              onChange={(e) => setPlannedTotalAgentsStr(e.target.value)}
            />
          </label>
          <span className="inline-flex items-center gap-0.5 self-end">
            <button
              type="button"
              className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
              onClick={() => setPlannedTotalAgentsStr(String(sidebarTotal))}
            >
              Sync from run config
            </button>
            <ParamHelp text="Sets Planned total N to the current Run sidebar cohort size (sum of agentCounts). Use after changing the population in Run configuration so the grid matches the sidebar again." />
          </span>
          <label className="flex min-w-[7rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              Max runs (budget)
              <ParamHelp text={`Upper bound on planned batch size (full factorial = product of per-axis levels; Random/LHS = sample runs when “Use max runs as sample size” is off, otherwise equals this cap for joint draws; OAT = sum of per-axis levels). Capped at ${GRID_ABS_MAX_RUNS.toLocaleString(
                "en-US",
              )}. With construction “Full factorial”, changing this value auto-fits after a short delay: numeric axes share one shrink multiplier (binary search), then enums subsample evenly only if the product is still too large. For Random/LHS with the checkbox on, batch size tracks this field automatically.`} />
            </span>
            <input
              type="number"
              min={1}
              max={GRID_ABS_MAX_RUNS}
              className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] tabular-nums text-[var(--text)]"
              value={maxRunsInput}
              onChange={(e) => setMaxRunsInput(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text)] hover:bg-[#1a1a1f]"
            onClick={() => applyFitToMaxRuns()}
          >
            Fit to max runs now
          </button>
          <label className="flex min-w-[8rem] flex-col gap-0.5 text-[10px] text-[var(--muted)]">
            <span className="inline-flex items-center gap-0.5">
              Max agents N (optional)
              <ParamHelp text="Hard limit on initial cohort size: sum of agentCounts in each cell after Planned total N rescaling and axis patches. Cells where Σ counts exceeds this cap are not run. In every runnable cell, spawn.maxAgents is clamped to this same ceiling so the engine cap cannot exceed your limit." />
            </span>
            <input
              type="number"
              min={1}
              placeholder="no cap"
              className="w-full max-w-[8rem] rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] tabular-nums text-[var(--text)] placeholder:text-zinc-600"
              value={maxAgentsInput}
              onChange={(e) => setMaxAgentsInput(e.target.value)}
            />
          </label>
        </div>
        {fitMessage ? (
          <p
            className={`text-[10px] leading-snug ${
              fitMessage.kind === "error" ? "text-amber-100/95" : "text-emerald-200/90"
            }`}
          >
            {fitMessage.text}
          </p>
        ) : null}
        {heatmapDisabledByAgentFilter ? (
          <p className="text-[10px] leading-snug text-amber-100/90">
            Heatmap disabled: max agents cap removes some design points (non-rectangular set). Use the results table after the batch.
          </p>
        ) : null}
      </section>

      <section
        className="rounded-lg border border-[var(--border)] bg-[#0c0c10] px-3 py-2.5"
        aria-label="Batch run plan"
      >
        <div className="flex flex-wrap items-center gap-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Run plan</div>
          <ParamHelp text="Preview of the current construction. Full factorial: level counts and product size update live; the Cartesian grid is not built until you click “Compute factorial grid” (avoids OOM while editing axes). Random/LHS: sample/strata notes; OAT: per-axis levels and sum. Runnable sims may drop if the max agents cap skips points. Cohort headcount is Planned total N under Batch caps (Hamilton mix at N, then axis patches)." />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono-n text-[11px] text-[var(--text)]">
          <span className="inline-flex items-center gap-0.5 text-[var(--muted)]">
            Levels
            <ParamHelp text="Per-axis level counts or construction summary (definition order). For full factorial, multiply counts for total design size before the max agents filter." />
          </span>
          <span className="tabular-nums">{levelProductLabel}</span>
          <span className="text-[var(--muted)]">→</span>
          <span>
            <strong className="text-sm tabular-nums">{plannedTotalRuns.toLocaleString("en-US")}</strong>
            <span className="text-[var(--muted)]">
              {gridConstruction === "full_factorial" ? " factorial" : " planned"}
            </span>
            {plannedSimsAfterAgentCap !== plannedTotalRuns ? (
              <span className="text-[var(--muted)]">
                {" "}
                →{" "}
                <strong className="text-sm tabular-nums text-[var(--text)]">
                  {plannedSimsAfterAgentCap.toLocaleString("en-US")}
                </strong>
                <span> runnable</span>
              </span>
            ) : null}
            <span className="text-[var(--muted)]"> sims</span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)]">
            · cohort{" "}
            <strong className="tabular-nums text-[var(--text)]">N={plannedGridN.toLocaleString("en-US")}</strong>
            {plannedGridN !== sidebarTotal ? (
              <span className="text-[var(--muted)]">
                {" "}
                (run sidebar {sidebarTotal.toLocaleString("en-US")})
              </span>
            ) : null}
            <ParamHelp text="Headcount each cell targets before count axes: Planned total N under Batch caps. Mix follows the Run sidebar proportions via Hamilton at N. Population count sweep rows override their slice after that rescaling." />
          </span>
          {maxAgentsCap != null && effectiveRunPlan.skippedByAgents > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-100/90">
              · {effectiveRunPlan.skippedByAgents.toLocaleString("en-US")} skipped (N &gt; cap)
              <ParamHelp text="Skipped cells would have started more agents than your max agents cap allows (sum of agentCounts after patches)." />
            </span>
          ) : null}
          {plannedTotalRuns > maxRunsUserCap && plannedTotalRuns <= GRID_ABS_MAX_RUNS ? (
            <span className="inline-flex items-center gap-0.5">
              <span
                className="rounded border border-sky-900/40 bg-sky-950/35 px-1.5 py-0.5 text-[10px] text-sky-100"
                title="Stricter than your max runs target"
              >
                Over max runs cap
              </span>
              <ParamHelp
                text={`Planned batch exceeds your max runs field (${maxRunsUserCap.toLocaleString(
                  "en-US",
                )}). Use “Fit to max runs now” or reduce steps / sample count / enabled axes until the plan fits.`}
              />
            </span>
          ) : null}
          {plannedTotalRuns > GRID_ABS_MAX_RUNS ? (
            <span className="inline-flex items-center gap-0.5">
              <span
                className="rounded border border-red-900/50 bg-red-950/35 px-1.5 py-0.5 text-[10px] text-red-200"
                title={`Hard cap ${GRID_ABS_MAX_RUNS.toLocaleString("en-US")} total simulations`}
              >
                Over cap
              </span>
              <ParamHelp
                text={`This design exceeds ${GRID_ABS_MAX_RUNS.toLocaleString(
                  "en-US",
                )} runs. Reduce enabled axes, tighten min/max, lower steps or sample count, or switch construction mode until the plan fits under the cap.`}
              />
            </span>
          ) : plannedSimsAfterAgentCap > GRID_WARN_TOTAL_RUNS ? (
            <span className="inline-flex items-center gap-0.5">
              <span
                className="rounded border border-amber-900/40 bg-amber-950/30 px-1.5 py-0.5 text-[10px] text-amber-100"
                title={`Will prompt for confirmation above ${GRID_WARN_TOTAL_RUNS.toLocaleString("en-US")} runnable sims`}
              >
                Confirm on run
              </span>
              <ParamHelp
                text={`If the batch will execute more than ${GRID_WARN_TOTAL_RUNS.toLocaleString(
                  "en-US",
                )} simulations (after max agents filtering), the browser asks once before starting. Absolute ceiling remains ${GRID_ABS_MAX_RUNS.toLocaleString("en-US")}.`}
              />
            </span>
          ) : plannedTotalRuns > 0 && gridConstruction === "full_factorial" ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)]">
              <span>product = axis resolution, not cohort N</span>
              <ParamHelp text="Here “product” is axis-level combinations (factorial size). Cohort headcount is the separate Planned total N value (see Batch caps); default points-per-axis scales with that cohort and spawn cap." />
            </span>
          ) : null}
        </div>
        {gridConstruction === "full_factorial" && enabledAxisIds.length > 0 ? (
          <div className="mt-2 flex flex-col gap-1.5 border-t border-[var(--border)] pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={computeFactorialGridDisabled}
                title={
                  factorialRows != null
                    ? "Grid already materialized for this axis configuration. Change an axis to rebuild."
                    : factorialMaterializeEstimate?.overHardBudget
                      ? `Estimated materialized size ~${formatEstBytes(factorialMaterializeEstimate.bytes)} exceeds safety budget ~${formatEstBytes(GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES)}`
                      : "Build all factorial rows in memory (required before Run grid)"
                }
                onClick={() => void computeFactorialGrid()}
                className="rounded-md bg-sky-900/50 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 hover:bg-sky-800/55 disabled:cursor-not-allowed disabled:bg-zinc-800/80 disabled:text-zinc-500"
              >
                {factorialRows != null ? "Factorial grid ready" : "Compute factorial grid"}
              </button>
              <ParamHelp text="Axis edits only update counts. This button allocates the full Cartesian assignment matrix (~estimated heap). Refused if the conservative estimate exceeds a browser safety budget even when the row count is under the absolute run cap." />
              {factorialMaterializeEstimate ? (
                <span className="text-[10px] text-[var(--muted)]">
                  Est. heap ~{formatEstBytes(factorialMaterializeEstimate.bytes)}
                  {factorialMaterializeEstimate.overHardBudget ? (
                    <span className="text-amber-200/95">
                      {" "}
                      (over ~{formatEstBytes(GRID_FACTORIAL_MATERIALIZE_MAX_EST_BYTES)} safety budget)
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            {factorialRows != null ? (
              <p className="text-[10px] leading-snug text-emerald-200/90">
                {factorialRows.length.toLocaleString("en-US")} design rows in memory — you can run the batch. Editing any sweep value clears this until you compute again.
              </p>
            ) : plannedTotalRuns > 0 &&
              plannedTotalRuns <= GRID_ABS_MAX_RUNS &&
              plannedTotalRuns <= maxRunsUserCap ? (
              <p className="text-[10px] leading-snug text-[var(--muted)]">
                Run grid stays disabled until the factorial is materialized here (prevents accidental huge allocations while tuning axes).
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="space-y-1.5">
        <div className="flex w-full min-w-0 items-stretch gap-1.5">
          <button
            type="button"
            disabled={runButtonDisabled}
            aria-busy={running}
            title={
              running
                ? `Running ${progress.done} / ${progress.total}`
                : (runBlockReason ?? "Run batch (Heuristic or QRE)")
            }
            onClick={() => void runGrid()}
            className="min-w-0 flex-1 rounded-md bg-zinc-700 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-600 disabled:cursor-not-allowed disabled:bg-zinc-800/90 disabled:text-zinc-400 disabled:hover:bg-zinc-800/90"
          >
            <span className="inline-flex items-center gap-1.5">
              {running ? (
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                  aria-hidden="true"
                />
              ) : null}
              <span>
                {running
                  ? `Grid ${progress.done}/${progress.total}…`
                  : `Run grid · ${plannedSimsAfterAgentCap.toLocaleString("en-US")} sims`}
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={!running}
            title={
              running
                ? "Stop after the current cell finishes (partial results are kept)"
                : "Run a batch first"
            }
            onClick={() => {
              batchCancelRequestedRef.current = true;
            }}
            className="shrink-0 rounded-md border border-red-900/55 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-100 hover:bg-red-950/70 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-zinc-900/50 disabled:text-zinc-600"
          >
            Stop batch
          </button>
          <ParamHelp text="Full factorial: Cartesian product of per-axis levels. Random/LHS/OAT: ordered list of design points. Heatmap only for full factorial with exactly two axes and a rectangular runnable set. Stop batch halts before the next cell; the in-flight simulation still completes." />
        </div>
        {running && progress.total > 0 ? (
          <div className="min-w-0 space-y-1" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
              <span>Grid batch progress</span>
              <span className="tabular-nums text-[var(--text)]">
                {progress.done.toLocaleString("en-US")} / {progress.total.toLocaleString("en-US")}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              aria-label={`Grid batch progress, ${progress.done} of ${progress.total} simulations complete`}
              className="h-1.5 w-full min-w-0 overflow-hidden rounded-full bg-[#1a1a1f]"
            >
              <div
                className="h-full min-w-0 rounded-full bg-emerald-700/80 transition-[width] duration-200 ease-out"
                style={{
                  width: `${progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        {!running && runBlockReason ? (
          <p className="flex flex-wrap items-center gap-1 text-[10px] leading-snug text-amber-100/90">
            <span>{runBlockReason}</span>
            <ParamHelp text="Run stays disabled until the plan is valid: heuristic or QRE mode, at least one axis on, factorial size within your max runs and the absolute ceiling, at least one runnable cell under the optional max agents cap, and non-zero runnable sims." />
          </p>
        ) : null}
      </div>

      {heatmapData ? (
        <div className="space-y-2">
          <div className="border-b border-[var(--border)] pb-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
              <span className="font-semibold text-[var(--text)]">Heatmap</span>
              <span className="text-[10px] text-[var(--muted)]">2 axes · final tick</span>
              <ParamHelp text="Each cell is colored by the metric you pick. Axes are the two enabled sweep parameters (definition order). Click a cell to load that run." />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-[10px] font-medium text-[var(--muted)]" htmlFor="batch-heatmap-metric">
                Color by
              </label>
              <select
                id="batch-heatmap-metric"
                className="max-w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-[11px]"
                value={heatmapMetric}
                onChange={(e) => setHeatmapMetric(e.target.value as HeatmapMetricKey)}
              >
                <option value="giniWealth">Wealth Gini</option>
                <option value="innovationFlow">Innovation (total)</option>
                <option value="meanWealth">Mean wealth / agent</option>
                <option value="innovationFlowPerAgent">Innovation / agent</option>
              </select>
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--muted)]">
              Rows: {getGridAxisDefinition(heatmapData.axisAId).short} · Cols:{" "}
              {getGridAxisDefinition(heatmapData.axisBId).short} · click cell → load run
            </p>
          </div>
          <div className="max-h-[min(55vh,520px)] max-w-full overflow-auto rounded border border-[var(--border)] bg-[#08080a] p-1">
            <table className="border-collapse font-mono-n text-[9px]">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-[12] bg-[#141418] p-0.5 pr-1 text-left text-[var(--muted)] shadow-[1px_0_0_var(--border),0_1px_0_rgba(0,0,0,0.35)]">
                    {`${getGridAxisDefinition(heatmapData.axisAId).short} \\ ${getGridAxisDefinition(heatmapData.axisBId).short}`}
                  </th>
                  {heatmapData.bVals.map((s, j) => (
                    <th
                      key={j}
                      className="sticky top-0 z-[2] min-w-[2.5rem] border-l border-[var(--border)] bg-[#141418] p-0.5 text-[var(--muted)]"
                      title={String(s)}
                    >
                      {formatAxisCellValue(s)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapData.cells.map((row, i) => (
                  <tr key={i}>
                    <td className="sticky left-0 z-10 bg-[#141418] p-0.5 pr-1 text-[var(--muted)]">
                      {formatAxisCellValue(heatmapData.aVals[i]!)}
                    </td>
                    {row.map((cell) => {
                      const r = results[cell.idx];
                      return (
                        <td
                          key={cell.idx}
                          className={`border border-[var(--border)] p-0.5 text-center ${
                            r ? "cursor-pointer hover:bg-[#1e3a5f]/40" : "text-[var(--muted)]"
                          }`}
                          title={r?.label}
                          onClick={() => {
                            if (r) props.onLoadRun(r);
                          }}
                        >
                          {cell.value == null
                            ? "—"
                            : cell.value.toFixed(heatmapCellDecimals(heatmapMetric))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="min-w-0 max-h-[min(70vh,640px)] overflow-auto rounded border border-[var(--border)]">
          <table className="w-max min-w-full border-collapse text-left font-mono-n text-[10px]">
            <thead className="sticky top-0 z-[5] bg-[#141418] text-[var(--muted)] shadow-[0_1px_0_rgba(0,0,0,0.35)]">
              <tr className="border-b border-[var(--border)]">
                <th
                  colSpan={resultsTableColSpan}
                  className="px-2 py-1.5 text-left text-[10px] font-normal leading-snug text-[var(--muted)]"
                >
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <span className="font-medium text-[var(--text)]">Run results</span>
                    <ParamHelp text="One row per factorial cell after the batch finishes. Click a label (or a heatmap cell when two axes) to load that run into the main lab. Metrics shown are from the final tick." />
                    <span className="tabular-nums">({results.length})</span>
                    <span className="text-[var(--border)]"> · </span>
                    <span>
                      {enabledAxisIds.length} axis{enabledAxisIds.length === 1 ? "" : "es"}
                      {enabledAxisIds.length > 2
                        ? " · table only (heatmap needs 2 axes)"
                        : " · row link or heatmap cell loads run"}
                    </span>
                  </span>
                </th>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <th className="sticky left-0 z-[6] bg-[#141418] p-1.5 text-right tabular-nums shadow-[1px_0_0_var(--border)]">
                  #
                </th>
                {enabledAxisIds.map((id) => {
                  const def = getGridAxisDefinition(id);
                  return (
                    <th
                      key={id}
                      className="max-w-[4rem] p-1.5 text-left align-bottom sm:max-w-none"
                      title={def.label}
                    >
                      <span className="block truncate sm:whitespace-nowrap">{def.short}</span>
                    </th>
                  );
                })}
                <th className="min-w-[6rem] p-1.5 sm:min-w-[10rem]" title="Composite cell description">
                  Label
                </th>
                <th className="p-1.5 text-right tabular-nums" title="Gini coefficient of wealth, final tick">
                  Gini
                </th>
                <th
                  className="p-1.5 text-right tabular-nums"
                  title="Mean wealth per agent (normalized), final tick"
                >
                  W/agent
                </th>
                <th
                  className="p-1.5 text-right tabular-nums"
                  title="Innovation flow ÷ agent count, final tick"
                >
                  I/agent
                </th>
                <th className="p-1.5 text-right tabular-nums" title="Innovation flow (raw), final tick">
                  I raw
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, n) => {
                const last = r.run.history[r.run.history.length - 1];
                const byId = new Map(r.assignments.map((a) => [a.id, a.value]));
                return (
                  <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[#1a1a1f]">
                    <td className="sticky left-0 z-[1] bg-[#0a0a0c] p-1.5 text-right tabular-nums text-[var(--muted)] shadow-[1px_0_0_var(--border)]">
                      {n + 1}
                    </td>
                    {enabledAxisIds.map((id) => (
                      <td
                        key={id}
                        className="max-w-[4rem] truncate p-1.5 text-left tabular-nums text-[var(--text)] sm:max-w-none sm:whitespace-nowrap"
                        title={byId.has(id) ? String(byId.get(id)) : undefined}
                      >
                        {byId.has(id) ? formatAxisCellValue(byId.get(id)!) : "—"}
                      </td>
                    ))}
                    <td className="max-w-[10rem] p-1.5 sm:max-w-none">
                      <button
                        type="button"
                        className="max-w-full truncate text-left text-[var(--accent)] hover:underline sm:max-w-none sm:whitespace-normal"
                        title={r.label}
                        onClick={() => props.onLoadRun(r)}
                      >
                        {r.label}
                      </button>
                    </td>
                    <td className="p-1.5 text-right tabular-nums">{last?.metrics.giniWealth.toFixed(3)}</td>
                    <td className="p-1.5 text-right tabular-nums">
                      {last ? meanWealthAtTick(last).toFixed(2) : "—"}
                    </td>
                    <td className="p-1.5 text-right tabular-nums">
                      {last && Number.isFinite(innovationFlowPerAgentAtTick(last))
                        ? innovationFlowPerAgentAtTick(last).toFixed(6)
                        : "—"}
                    </td>
                    <td className="p-1.5 text-right tabular-nums">
                      {last && Number.isFinite(innovationFlowAtTick(last))
                        ? innovationFlowAtTick(last).toFixed(2)
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
