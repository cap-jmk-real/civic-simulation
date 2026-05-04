"use client";

import type { AgentState, SimulationRun, WorldState } from "@ip-sim/core";
import { FieldLabel, ParamHelp } from "@/components/ParamHelp";
import {
  encodeGraphEvolutionGif,
  encodeGraphEvolutionWebm,
  graphExportDefaultRange,
} from "@/lib/graphReplayEncoder";
import { useCallback, useEffect, useMemo, useState } from "react";

type Run = SimulationRun & { finalWorld?: WorldState };

export function GraphEvolutionExport(props: {
  run: Run | null;
  finalAgents: AgentState[] | null;
  layoutSeed: number;
}) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [maxFrames, setMaxFrames] = useState(72);
  const [fps, setFps] = useState(8);
  const [busy, setBusy] = useState<"gif" | "webm" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const bounds = useMemo(() => {
    const r = props.run;
    if (!r?.history.length) return { max: 0, def: { start: 0, end: 0 } };
    const { start: ds, end: de } = graphExportDefaultRange(r);
    return { max: r.history.length - 1, def: { start: ds, end: de } };
  }, [props.run]);

  useEffect(() => {
    if (!props.run?.history.length) return;
    const { start: s, end: e } = graphExportDefaultRange(props.run);
    setStart(s);
    setEnd(e);
  }, [props.run?.manifest.seed, props.run?.history.length]);

  const syncDefaults = useCallback(() => {
    if (!props.run?.history.length) return;
    const { start: s, end: e } = graphExportDefaultRange(props.run);
    setStart(s);
    setEnd(e);
  }, [props.run]);

  const disabled = !props.run?.history.length || !props.finalAgents?.length || busy !== null;

  const doGif = useCallback(async () => {
    if (!props.run?.history.length || !props.finalAgents) return;
    setBusy("gif");
    setProgress("0%");
    try {
      const blob = await encodeGraphEvolutionGif(
        props.run.history,
        props.finalAgents,
        {
          layoutSeed: props.layoutSeed,
          fps,
          startTick: Math.min(start, end),
          endTick: Math.max(start, end),
          maxFrames: Math.min(240, Math.max(1, maxFrames)),
          subtitle: `seed ${props.run.manifest.seed}`,
          onProgress: (d, t) => setProgress(`${Math.round((100 * d) / t)}%`),
        },
      );
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ip-abm-graph-${props.run.manifest.seed}.gif`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [props.run, props.finalAgents, props.layoutSeed, fps, start, end, maxFrames]);

  const doWebm = useCallback(async () => {
    if (!props.run?.history.length || !props.finalAgents) return;
    setBusy("webm");
    setProgress("0%");
    try {
      const blob = await encodeGraphEvolutionWebm(
        props.run.history,
        props.finalAgents,
        {
          layoutSeed: props.layoutSeed,
          fps,
          startTick: Math.min(start, end),
          endTick: Math.max(start, end),
          maxFrames: Math.min(240, Math.max(1, maxFrames)),
          subtitle: `seed ${props.run.manifest.seed}`,
          onProgress: (d, t) => setProgress(`${Math.round((100 * d) / t)}%`),
        },
      );
      if (!blob) {
        alert("WebM encoding not supported in this browser.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ip-abm-graph-${props.run.manifest.seed}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [props.run, props.finalAgents, props.layoutSeed, fps, start, end, maxFrames]);

  if (!props.run?.history.length) return null;

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[#0a0a0c] p-3">
      <div className="mb-2 inline-flex flex-wrap items-center gap-2 font-mono-n text-[11px] font-medium text-[var(--muted)]">
        Record graph evolution
        <ParamHelp text="Renders the same network view as the overview into a short animation. Tick range is subsampled to at most “max frames” so long runs stay responsive; layout is fixed from the first sampled frame (wealth and edges update each frame)." />
        <button
          type="button"
          onClick={syncDefaults}
          className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] hover:bg-[#1a1a1f]"
        >
          Reset range
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[10px] text-[var(--muted)]">
          <FieldLabel help="First history index included in the animation (inclusive).">Start tick index</FieldLabel>
          <input
            type="number"
            min={0}
            max={bounds.max}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-xs"
            value={start}
            onChange={(e) => setStart(Math.max(0, Math.min(bounds.max, Number(e.target.value) || 0)))}
          />
        </label>
        <label className="text-[10px] text-[var(--muted)]">
          <FieldLabel help="Last history index included (inclusive); if greater than start, range runs forward.">End tick index</FieldLabel>
          <input
            type="number"
            min={0}
            max={bounds.max}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-xs"
            value={end}
            onChange={(e) => setEnd(Math.max(0, Math.min(bounds.max, Number(e.target.value) || 0)))}
          />
        </label>
        <label className="text-[10px] text-[var(--muted)]">
          <FieldLabel help="Upper bound on animation frames; the exporter evenly samples indices across your tick range (max 240).">
            Max frames
          </FieldLabel>
          <input
            type="number"
            min={1}
            max={240}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-xs"
            value={maxFrames}
            onChange={(e) => setMaxFrames(Math.min(240, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
          />
        </label>
        <label className="text-[10px] text-[var(--muted)]">
          <FieldLabel help="Playback speed for the exported file (frames per second).">FPS</FieldLabel>
          <input
            type="number"
            min={1}
            max={24}
            className="mt-0.5 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 font-mono-n text-xs"
            value={fps}
            onChange={(e) => setFps(Math.min(24, Math.max(1, Math.floor(Number(e.target.value) || 8))))}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void doGif()}
          className="rounded border border-emerald-800/50 bg-emerald-950/35 px-3 py-2 text-xs hover:bg-emerald-950/55 disabled:opacity-40"
        >
          {busy === "gif" ? `GIF… ${progress ?? ""}` : "Download graph GIF"}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void doWebm()}
          className="rounded border border-violet-700/50 bg-violet-950/40 px-3 py-2 text-xs hover:bg-violet-950/60 disabled:opacity-40"
        >
          {busy === "webm" ? `WebM… ${progress ?? ""}` : "Download graph WebM"}
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
        GIF uses gifenc (256-color palette from frame 0). For long spans or many agents, WebM is
        usually much smaller. Hard cap 240 frames per export; sampled graphs lock to the same agent
        subset as the first frame when the cohort exceeds the 200-node sample cap.
      </p>
    </div>
  );
}
