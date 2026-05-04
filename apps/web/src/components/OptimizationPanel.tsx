"use client";

import type { SimConfig } from "@ip-sim/core";
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
  runEvolutionarySearch,
  type OptimizationMetricKey,
  type OptimizationObjective,
} from "@/lib/evolutionaryOptimize";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";

const DEFAULT_OPT_AXES: GridAxisId[] = ["policy.enforcementIntensity", "policy.openScienceSubsidy"];

/** Soft cap for GA population size input; hard cap is max eval budget (and absolute grid ceiling). */
const OPT_GA_MAX_POPULATION = 256;
const OPT_MAX_SIM_TICKS = 100_000;
/** Rolling UI cap — full runs are still retained for the current leader + loading the leader. */
const MAX_OPT_TRIAL_ROWS = 400;

type OptTrialRow = {
  id: string;
  generation: number;
  evaluationNumber: number;
  metricValue: number | null;
  mse: number;
  label: string;
  cell: GridCellResult;
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

export function OptimizationPanel(props: {
  baseConfig: SimConfig;
  mode: "heuristic" | "qre" | "llm";
  qreTemp: number;
  onLoadBestRun: (cell: GridCellResult) => void;
}) {
  const [selectedAxes, setSelectedAxes] = useState<Set<GridAxisId>>(() => new Set(DEFAULT_OPT_AXES));
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
  const cancelRef = useRef(false);
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
  const [uiClock, setUiClock] = useState(0);
  const [currentEvalLive, setCurrentEvalLive] = useState<{
    evaluationNumber: number;
    generation: number;
    shortLabel: string;
  } | null>(null);
  const [lastWallMs, setLastWallMs] = useState<number | null>(null);

  const optimizationRunStartMsRef = useRef<number | null>(null);
  const currentEvalStartMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setUiClock((c) => c + 1), 250);
    return () => window.clearInterval(id);
  }, [running]);

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
    props.mode !== "heuristic" ||
    running ||
    axisIds.length === 0 ||
    (objective === "target" && !Number.isFinite(target)) ||
    evalOverBudget ||
    plannedGridN < 1;

  const cohortTotalAgents = useMemo(() => totalAgents(optBaseConfig.agentCounts), [optBaseConfig.agentCounts]);

  const runOptimization = useCallback(
    async (sessionMode: "fresh" | "continue") => {
      if (props.mode !== "heuristic" || running || axisIds.length === 0) return;
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

      cancelRef.current = false;
      setRunning(true);
      setProgress(null);
      setResult(null);
      optimizationRunStartMsRef.current = Date.now();
      currentEvalStartMsRef.current = null;

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

      setCurrentEvalLive(null);
      setLastWallMs(null);

      try {
        const out = await runEvolutionarySearch({
        baseConfig: optBaseConfig,
        mode: props.mode,
        qreTemp: props.qreTemp,
        axisIds,
        metric,
        target,
        objective,
        maxAgentsCap,
        populationSize,
        generations: gens,
        mutationRate,
        resumeFromBestGenes:
          sessionMode === "continue" ? lastBestGenesRef.current ?? undefined : undefined,
        evaluationNumberOffset: resumeBaselineEvalRef.current,
        generationDisplayOffset: resumeGenBaselineRef.current,
        shouldCancel: () => cancelRef.current,
        yieldToUi: () => new Promise((r) => requestAnimationFrame(() => r())),
        onEvaluationBegin: (beg) => {
          const parts = beg.assignments.map((a) => {
            const def = getGridAxisDefinition(a.id);
            return `${def.short} ${formatAxisCellValue(a.value)}`;
          });
          currentEvalStartMsRef.current = Date.now();
          setCurrentEvalLive({
            evaluationNumber: beg.evaluationNumber,
            generation: beg.generation,
            shortLabel: parts.join(" · "),
          });
        },
        onEvaluation: (ev) => {
          const durMs =
            currentEvalStartMsRef.current != null ? Date.now() - currentEvalStartMsRef.current : null;
          currentEvalStartMsRef.current = null;
          setCurrentEvalLive(null);

          setTotalEvalCount(ev.evaluationNumber);
          const parts = ev.assignments.map((a) => {
            const def = getGridAxisDefinition(a.id);
            return `${def.short} ${formatAxisCellValue(a.value)}`;
          });
          const shortLabel = parts.join(" · ");
          const label = `G${ev.generation + 1} #${ev.evaluationNumber} · ${shortLabel}`;
          const id = `opt_e_${ev.evaluationNumber}_${props.baseConfig.seed}`;
          const cell: GridCellResult = {
            id,
            label: `Opt · ${label}`,
            assignments: ev.assignments,
            run: ev.run as GridCellResult["run"],
          };
          setTrialRows((prev) => {
            const row: OptTrialRow = {
              id,
              generation: ev.generation,
              evaluationNumber: ev.evaluationNumber,
              metricValue: ev.metricValue,
              mse: ev.mse,
              label: shortLabel,
              cell,
              durationMs: durMs,
            };
            const next = [...prev, row];
            while (next.length > MAX_OPT_TRIAL_ROWS) next.shift();
            return next;
          });
          if (ev.isNewBest) {
            setLeaderRowId(id);
            setLeaderCell(cell);
          }
        },
        onGeneration: ({ generation, bestMse, evaluations }) => {
          setProgress({
            generation,
            evaluations,
            bestRmse: Math.sqrt(Math.max(0, bestMse)),
            bestMetric: -bestMse,
            progressObjective: objective,
          });
        },
      });

      const last = out.bestRun.history[out.bestRun.history.length - 1];
      const achieved = last ? readOptimizationMetric(last, metric) : null;
      const labelParts = out.bestAssignments.map((a) => {
        const def = getGridAxisDefinition(a.id);
        return `${def.short} ${formatAxisCellValue(a.value)}`;
      });
      const assignmentsLabel = labelParts.join(" · ");
      setResult({
        objective,
        rmse: objective === "target" ? Math.sqrt(Math.max(0, out.bestMse)) : null,
        achieved: achieved != null && Number.isFinite(achieved) ? achieved : null,
        assignmentsLabel,
        evaluations: out.evaluations,
        cancelled: out.cancelled,
      });
      lastBestRef.current = {
        run: out.bestRun as GridCellResult["run"],
        assignments: out.bestAssignments,
        label: `Opt · ${assignmentsLabel}`,
      };
      lastBestGenesRef.current = out.bestGenes;
      setResumeGeneCount(out.bestGenes.length);
      resumeBaselineEvalRef.current += out.evaluations;
      resumeGenBaselineRef.current += out.generationsCompleted;
    } finally {
      const startedAt = optimizationRunStartMsRef.current;
      if (startedAt != null) setLastWallMs(Date.now() - startedAt);
      cancelRef.current = false;
      setRunning(false);
      setCurrentEvalLive(null);
      currentEvalStartMsRef.current = null;
    }
  }, [
    axisIds,
    evalOverBudget,
    generations,
    maxAgentsCap,
    metric,
    mutationRate,
    objective,
    optBaseConfig,
    plannedGridN,
    populationSize,
    props.mode,
    props.qreTemp,
    props.baseConfig.seed,
    target,
    continueGenerations,
    maxOptEvalCap,
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

  const continueEvalBudget = populationSize * Math.max(1, continueGenerations);
  const continueOverBudget = continueEvalBudget > maxOptEvalCap;
  const resumeMatchesAxes =
    resumeGeneCount != null && resumeGeneCount === axisIds.length && axisIds.length > 0;
  const continueDisabled =
    props.mode !== "heuristic" ||
    running ||
    !resumeMatchesAxes ||
    continueOverBudget ||
    plannedGridN < 1 ||
    (objective === "target" && !Number.isFinite(target));

  return (
    <details className="rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] px-3 py-2" open>
      <summary className="cursor-pointer list-none text-xs font-medium text-[var(--muted)] [&::-webkit-details-marker]:hidden">
        <span className="inline-flex flex-wrap items-center gap-1">
          Outcome optimization
          <ParamHelp text="Genetic search over checked axes with a rolling trial table like the parameter grid: each evaluation loads into the main viewer for replay (network, metrics, timeline). Trials run the Rust/WASM heuristic simulation. Current leader is highlighted; cohort/ticks come from the section above. Only policy mode Heuristic is supported (not LLM or QRE)." />
        </span>
      </summary>

      <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-2">
        {props.mode !== "heuristic" ? (
          <p className="text-[10px] text-amber-100/90">
            Outcome optimization runs the Rust/WASM heuristic engine only; switch policy mode to Heuristic.
          </p>
        ) : null}

        <section
          className="space-y-2 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-2.5 py-2"
          aria-label="Optimization cohort and run length"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Cohort &amp; duration</div>
          <div className="flex flex-wrap items-end gap-2">
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
            <span className="inline-flex items-center gap-0.5 self-end">
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
            <span className="inline-flex items-center gap-0.5 self-end">
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
          <div className="flex flex-wrap items-end gap-2">
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
          <div className="max-h-36 space-y-0.5 overflow-y-auto text-[11px]">
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

        <label className="block text-[10px] text-[var(--muted)]">
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

        <fieldset className="space-y-1 border-0 p-0">
          <legend className="text-[10px] text-[var(--muted)]">Objective</legend>
          <div className="flex flex-wrap gap-3 text-[11px]">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="opt-objective"
                checked={objective === "target"}
                onChange={() => setObjective("target")}
                className="rounded-full border-[var(--border)]"
              />
              Match target value
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="opt-objective"
                checked={objective === "maximize"}
                onChange={() => setObjective("maximize")}
                className="rounded-full border-[var(--border)]"
              />
              Maximize metric
            </label>
          </div>
        </fieldset>

        <label className={`block text-[10px] text-[var(--muted)] ${objective !== "target" ? "opacity-50" : ""}`}>
          Target value
          <input
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px] disabled:cursor-not-allowed"
            value={targetStr}
            onChange={(e) => setTargetStr(e.target.value)}
            disabled={objective !== "target"}
            aria-disabled={objective !== "target"}
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
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

        <div className="relative z-30 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={startDisabled}
            onClick={() => void runOptimization("fresh")}
            className="rounded-md bg-emerald-900/60 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-800/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? "Optimizing…" : "Run optimization"}
          </button>
          <button
            type="button"
            disabled={!running}
            title="Sets cancel — honored between evaluations (after requestAnimationFrame yields), not during a WASM simulation call."
            onClick={() => {
              cancelRef.current = true;
            }}
            className="pointer-events-auto rounded-md border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-100 hover:bg-red-950/70 disabled:opacity-40"
          >
            Stop
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded border border-[var(--border)] border-dashed bg-[#0c0c10] px-2 py-2">
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
            className="rounded-md border border-amber-800/60 bg-amber-950/50 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue optimization
          </button>
          {!resumeMatchesAxes && resumeGeneCount != null ? (
            <span className="text-[10px] text-amber-100/85">
              Resume genes ({resumeGeneCount} dims) don&apos;t match selected axes ({axisIds.length}). Run a fresh search or
              restore axes.
            </span>
          ) : null}
          {continueOverBudget ? (
            <span className="text-[10px] text-amber-100/85">
              Continue segment ({continueEvalBudget.toLocaleString("en-US")} evals) exceeds max eval budget.
            </span>
          ) : null}
        </div>

        {running ? (
          <div
            className="space-y-2 rounded-lg border border-sky-900/40 bg-[#0a1018] px-2.5 py-2 font-mono-n text-[10px]"
            data-ui-tick={uiClock}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-sky-100/95">Live progress</span>
              <ParamHelp text="Trials run strictly one after another via the Rust/WASM heuristic engine. Stop applies between evaluations (requestAnimationFrame yield), not mid-WASM-call." />
            </div>
            <p className="leading-snug text-[var(--muted)]">
              {currentEvalLive ? (
                <>
                  <span className="text-[var(--text)]">Now simulating</span> · Gen {currentEvalLive.generation + 1} · eval{" "}
                  <span className="tabular-nums text-sky-200/95">
                    {currentEvalLive.evaluationNumber}/{segPlan.toLocaleString("en-US")}
                  </span>
                  <span className="text-[var(--border)]"> · </span>
                  <span className="break-words text-[11px] text-[var(--text)]">{currentEvalLive.shortLabel}</span>
                </>
              ) : (
                <span className="text-[var(--muted)]">Preparing next evaluation…</span>
              )}
            </p>
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#1a1a22]">
                <div
                  className="h-full rounded-full bg-sky-700/80 transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--muted)]">
                <span>
                  Throughput:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {segmentDoneEvals.toLocaleString("en-US")}/{segPlan.toLocaleString("en-US")}
                  </span>{" "}
                  ({progressPct.toFixed(1)}%)
                </span>
                <span>
                  Elapsed:{" "}
                  <span className="tabular-nums text-[var(--text)]">
                    {liveElapsedMs != null ? formatMsClock(liveElapsedMs) : "—"}
                  </span>
                </span>
                {etaMs != null && Number.isFinite(etaMs) ? (
                  <span title="Average duration × remaining evaluations">
                    ETA: <span className="tabular-nums text-[var(--text)]">~{formatMsClock(etaMs)}</span>
                  </span>
                ) : running && segmentDoneEvals === 0 ? (
                  <span className="text-[var(--muted)]">ETA: …</span>
                ) : null}
                {curEvalElapsedMs != null ? (
                  <span>
                    This eval:{" "}
                    <span className="tabular-nums text-amber-100/90">{formatMsClock(curEvalElapsedMs)}</span>
                  </span>
                ) : null}
              </div>
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
        ) : null}

        {result ? (
          <div className="space-y-1 rounded border border-[var(--border)] bg-[#0c0c10] p-2 text-[11px]">
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

        {(running || trialRows.length > 0 || leaderCell) && (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[#0c0c10] px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
              <span className="font-semibold text-[var(--text)]">Trial runs</span>
              <ParamHelp text="One row per finished simulation evaluation (same as grid batch cells). ★ marks the current genetic-algorithm leader on your objective metric. Click a label or Load to replay that run in the main viewer (network, metrics, timeline)." />
              <span className="tabular-nums text-[var(--muted)]">
                {totalEvalCount > 0 ? (
                  <>
                    {trialRows.length < totalEvalCount ? (
                      <>
                        Last {trialRows.length.toLocaleString("en-US")} of{" "}
                        {totalEvalCount.toLocaleString("en-US")} evals (rolling window)
                      </>
                    ) : (
                      <>{totalEvalCount.toLocaleString("en-US")} evals</>
                    )}
                  </>
                ) : (
                  "No evaluations yet"
                )}
              </span>
            </div>

            {leaderCell ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-900/40 bg-emerald-950/25 px-2 py-1.5 font-mono-n text-[10px]">
                <span className="font-medium text-emerald-100/95">Current leader</span>
                <span className="text-[var(--muted)]">{OPTIMIZATION_METRIC_LABELS[metric]}:</span>
                <span className="tabular-nums text-[var(--text)]">
                  {formatOptimizationMetricCell(
                    metric,
                    leaderCell.run.history[leaderCell.run.history.length - 1]
                      ? readOptimizationMetric(leaderCell.run.history[leaderCell.run.history.length - 1]!, metric)
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

            {trialRows.length > 0 ? (
              <div className="max-h-[min(55vh,480px)] overflow-auto rounded border border-[var(--border)]">
                <table className="w-max min-w-full border-collapse text-left font-mono-n text-[10px]">
                  <thead className="sticky top-0 z-[5] bg-[#141418] text-[var(--muted)] shadow-[0_1px_0_rgba(0,0,0,0.35)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="sticky left-0 z-[6] bg-[#141418] p-1.5 text-right shadow-[1px_0_0_var(--border)]">#</th>
                      <th className="p-1.5 text-right">Gen</th>
                      <th className="p-1.5 text-right">Eval</th>
                      <th className="p-1.5 text-center" title="Genetic algorithm leader">
                        ★
                      </th>
                      <th className="min-w-[5rem] p-1.5 text-right" title={OPTIMIZATION_METRIC_LABELS[metric]}>
                        {metric === "innovationFlowPerMeanWealth" ? "I/W̄" : OPTIMIZATION_METRIC_LABELS[metric].slice(0, 12)}
                      </th>
                      {objective === "target" ? (
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
                    {trialRows.map((row, idx) => {
                      const last = row.cell.run.history[row.cell.run.history.length - 1];
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
                            {idx + 1}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">{row.generation + 1}</td>
                          <td className="p-1.5 text-right tabular-nums">{row.evaluationNumber}</td>
                          <td className="p-1.5 text-center text-amber-200/90">{isLeader ? "★" : ""}</td>
                          <td className="p-1.5 text-right tabular-nums">
                            {formatOptimizationMetricCell(metric, row.metricValue)}
                          </td>
                          {objective === "target" ? (
                            <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                              {Number.isFinite(rmse) ? rmse.toPrecision(4) : "—"}
                            </td>
                          ) : null}
                          <td className="p-1.5 text-right tabular-nums">{last?.metrics.giniWealth.toFixed(3) ?? "—"}</td>
                          <td className="p-1.5 text-right tabular-nums">
                            {last ? meanWealthAtTick(last).toFixed(2) : "—"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums">
                            {last && Number.isFinite(innovationFlowPerAgentAtTick(last))
                              ? innovationFlowPerAgentAtTick(last).toFixed(6)
                              : "—"}
                          </td>
                          <td className="p-1.5 text-right tabular-nums text-[var(--muted)]">
                            {row.durationMs != null ? formatMsClock(row.durationMs) : "—"}
                          </td>
                          <td className="max-w-[14rem] p-1.5">
                            <button
                              type="button"
                              className="max-w-full truncate text-left text-[var(--accent)] hover:underline"
                              title={row.cell.label}
                              onClick={() => loadTrialCell(row.cell)}
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
          </div>
        )}
      </div>
    </details>
  );
}
