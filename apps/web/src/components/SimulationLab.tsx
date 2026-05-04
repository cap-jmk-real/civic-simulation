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
import {
  addBatchToProject,
  createProject,
  gridResultsToBatch,
  listProjects,
} from "@/lib/analysisStorage";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BatchGridPanel, type GridCellResult } from "./BatchGridPanel";
import { OptimizationPanel } from "./OptimizationPanel";
import { ForceGraph } from "./ForceGraph";
import { GraphEvolutionExport } from "./GraphEvolutionExport";
import { GraphLegend } from "./GraphLegend";
import { MetricsCharts } from "./MetricsCharts";
import { ReplayToolbar } from "./ReplayToolbar";

type PolicyMode = "heuristic" | "qre" | "llm";

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
  const [analysisProjectName, setAnalysisProjectName] = useState("My analyses");
  const [analysisBatchName, setAnalysisBatchName] = useState("");
  const [lastGridBatch, setLastGridBatch] = useState<{
    results: GridCellResult[];
    constructionLabel: string;
    levelProductLabel: string;
  } | null>(null);
  /** Bumps to clear graph node selection (new run or explicit clear). */
  const [graphSelectionVersion, setGraphSelectionVersion] = useState(0);
  const [selectedGraphNodeIds, setSelectedGraphNodeIds] = useState<string[]>([]);

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

  const saveGridToAnalysis = useCallback(() => {
    if (!lastGridBatch || lastGridBatch.results.length === 0) return;
    const batch = gridResultsToBatch(
      analysisBatchName,
      lastGridBatch.results,
      lastGridBatch.constructionLabel,
      lastGridBatch.levelProductLabel,
    );
    const name = analysisProjectName.trim() || "My analyses";
    const projects = listProjects();
    const existing = projects.find((p) => p.name === name);
    const project = existing ?? createProject(name);
    addBatchToProject(project.id, batch);
  }, [analysisBatchName, analysisProjectName, lastGridBatch]);

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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [config, mode, qreTemp, run]);

  const runLlm = useCallback(async () => {
    setError(null);
    setRunning(true);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [config, run]);

  const onRun = () => {
    if (mode === "llm") void runLlm();
    else void runSync();
  };

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
    <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_1fr_340px]">
      <aside className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
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
            <p className="flex min-w-0 items-baseline font-mono-n text-[10px] leading-tight text-[var(--muted)] sm:col-span-2">
              <span className="min-w-0 break-words">
                bigco {config.agentCounts.bigco} · acad {config.agentCounts.academic} · smb{" "}
                {config.agentCounts.smb} · solo {config.agentCounts.solo} · Σ{" "}
                {totalAgents(config.agentCounts)}
              </span>
            </p>
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
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Scales the strength/cost of IP enforcement actions (litigation-style transfers when overlapping patents exist). Higher values intensify deterrence and dispute spending in the model.">
                  Enforcement
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Enforcement intensity"
                className="mt-1 w-full"
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
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Public support that lowers the wealth cost of open publication and magnifies knowledge spillovers into the global pool (policy lever for disclosure vs secrecy).">
                  Open science subsidy
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Open science subsidy"
                className="mt-1 w-full"
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
                className="mt-1 w-full"
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
            <div className="min-w-0 sm:col-span-2">
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
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Desired baseline strictness of mitigation (feeds effective stringency together with scale and corruption). Higher ambition pushes faster reduction of aggregated net harm when regulation is enabled.">
                  Reg. ambition
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Regulatory ambition"
                className="mt-1 w-full"
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--muted)] sm:col-span-2">
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Multiplicative decay of wealth each tick (maintenance, consumption, capital loss). Higher values erode cash balances faster between market rounds.">
                  Wealth depreciation / tick
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Wealth depreciation rate"
                className="mt-1 w-full"
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
            <div className="min-w-0 sm:col-span-2">
              <label className="block text-xs text-[var(--muted)]">
                <FieldLabel help="Knowledge stock lost to obsolescence or forgetting each tick. Higher values make proprietary know-how decay unless continuously replenished.">
                  Knowledge depreciation / tick
                </FieldLabel>
              </label>
              <input
                type="range"
                aria-label="Knowledge depreciation rate"
                className="mt-1 w-full"
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
            <div className="min-w-0 sm:col-span-2">
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
              <div className="min-w-0 sm:col-span-2">
                <label className="block text-xs text-[var(--muted)]">
                  <FieldLabel help="Softmax temperature in QRE: low values concentrate probability on the highest-utility actions (more “rational”); high values randomize more—exploration vs exploitation in discrete choice.">
                    QRE temperature
                  </FieldLabel>
                </label>
                <input
                  type="range"
                  aria-label="QRE temperature"
                  className="mt-1 w-full"
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

        <div className="mt-2 flex w-full items-center gap-1">
          <button
            type="button"
            disabled={running}
            onClick={onRun}
            className="min-w-0 flex-1 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-95 disabled:opacity-50"
          >
            {running ? "Running…" : "Run simulation"}
          </button>
          <ParamHelp text="Executes the configured ticks with the selected decision rule (heuristic, QRE, or LLM). Produces the history used by charts, tables, and replay—deterministic for heuristic/QRE at fixed seed." />
        </div>

        <div className="flex w-full items-center gap-1">
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

        <BatchGridPanel
          baseConfig={config}
          mode={mode}
          qreTemp={qreTemp}
          onLoadRun={loadGridCell}
          onBatchFinished={(results, meta) => {
            if (results.length > 0) {
              setLastGridBatch({
                results,
                constructionLabel: meta.constructionLabel,
                levelProductLabel: meta.levelProductLabel,
              });
            }
          }}
        />

        <OptimizationPanel baseConfig={config} mode={mode} qreTemp={qreTemp} onLoadBestRun={loadGridCell} />

        <section className="space-y-2 rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-[var(--muted)]">Batch analytics (local storage)</h3>
            <Link
              href="/analysis"
              className="text-[11px] text-[var(--accent)] hover:underline"
            >
              Open analysis chat →
            </Link>
          </div>
          {lastGridBatch && lastGridBatch.results.length > 0 ? (
            <p className="text-[10px] text-[var(--muted)]">
              Last finished grid: {lastGridBatch.results.length} cell(s) · {lastGridBatch.constructionLabel} ·{" "}
              {lastGridBatch.levelProductLabel}
            </p>
          ) : (
            <p className="text-[10px] text-[var(--muted)]">Run a parameter grid batch to enable saving.</p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[8rem] flex-1 text-[10px] text-[var(--muted)]">
              Project name
              <input
                className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-[11px]"
                value={analysisProjectName}
                onChange={(e) => setAnalysisProjectName(e.target.value)}
              />
            </label>
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
              onClick={saveGridToAnalysis}
              className="rounded-md bg-zinc-600 px-3 py-1.5 text-xs text-white hover:bg-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save batch to project
            </button>
          </div>
        </section>

        {error && (
          <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-200">
            {error}
          </p>
        )}
      </aside>

      <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Network · topology at playhead (wealth-sized nodes)</h2>
          <span className="font-mono-n text-xs text-[var(--muted)]">
            tick {displayTick?.metrics.tick ?? "—"} / {run?.history.length ?? 0}
          </span>
        </div>
        {run?.finalWorld && agentsAtTick && displayTick ? (
          <>
            <ForceGraph
              agents={agentsAtTick}
              edges={displayTick.edges}
              width={720}
              height={420}
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
          <div className="flex h-[420px] items-center justify-center rounded border border-dashed border-[var(--border)] text-sm text-[var(--muted)]">
            Run a simulation to populate the collaboration graph.
          </div>
        )}
      </section>

      <aside className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-medium">Society metrics</h2>
        {displayTick ? (
          <dl className="grid grid-cols-2 gap-2 font-mono-n text-xs">
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

        <div className="border-t border-[var(--border)] pt-3">
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
  );
}
