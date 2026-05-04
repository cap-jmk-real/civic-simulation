"use client";

import { ParamHelp } from "@/components/ParamHelp";

export function ReplayToolbar(props: {
  disabled: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  playbackTps: number;
  onPlaybackTps: (v: number) => void;
  tickIndex: number;
  totalSteps: number;
  exporting: boolean;
  exportingGif: boolean;
  onExportWebm: () => void;
  onExportGif: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[#0a0a0c] p-3">
      <div className="inline-flex items-center gap-1 font-mono-n text-[11px] font-medium text-[var(--muted)]">
        Timeline replay
        <ParamHelp text="Animates stored tick history so you can watch the collaboration network evolve; exports render the same sequence to video or GIF." />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onTogglePlay}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[#1a1a1f] disabled:opacity-40"
          >
            {props.playing ? "Pause" : "Play"}
          </button>
          <ParamHelp text="Steps the playhead forward at the chosen rate through recorded ticks without recomputing the simulation." />
        </span>
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onReset}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[#1a1a1f] disabled:opacity-40"
          >
            Reset
          </button>
          <ParamHelp text="Returns to the first tick of the stored run (time index zero)." />
        </span>
        <label className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-0.5">
            Speed
            <ParamHelp text="Replay cadence in ticks per wall-clock second; higher values skim faster through long histories." />
          </span>
          <select
            className="rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-xs"
            value={props.playbackTps}
            disabled={props.disabled}
            onChange={(e) => props.onPlaybackTps(Number(e.target.value))}
          >
            <option value={1}>1 tick/s</option>
            <option value={2}>2 tick/s</option>
            <option value={4}>4 tick/s</option>
            <option value={8}>8 tick/s</option>
            <option value={16}>16 tick/s</option>
          </select>
        </label>
        <span className="inline-flex items-center gap-1 font-mono-n text-[11px] text-[var(--muted)]">
          frame {props.tickIndex + 1}/{props.totalSteps || 0}
          <ParamHelp text="Current history index vs total recorded steps (one frame per tick in the exported animations)." />
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            disabled={props.disabled || props.exporting || props.exportingGif}
            onClick={props.onExportWebm}
            className="min-w-0 flex-1 rounded border border-violet-700/50 bg-violet-950/40 px-3 py-2 text-xs hover:bg-violet-950/60 disabled:opacity-40"
          >
            {props.exporting ? "Encoding WebM…" : "Export WebM"}
          </button>
          <ParamHelp text="Encodes the replay as WebM video (browser codec). Good quality and smaller files than GIF for long runs." />
        </span>
        <span className="inline-flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            disabled={props.disabled || props.exporting || props.exportingGif}
            onClick={props.onExportGif}
            className="min-w-0 flex-1 rounded border border-emerald-800/50 bg-emerald-950/35 px-3 py-2 text-xs hover:bg-emerald-950/55 disabled:opacity-40"
          >
            {props.exportingGif ? "Encoding GIF…" : "Export GIF"}
          </button>
          <ParamHelp text="Builds a palette GIF from the same frames; widely compatible but can be large—prefer shorter runs or lower fps." />
        </span>
      </div>
      <p className="text-[10px] leading-snug text-[var(--muted)]">
        These exports animate society metrics sparklines. For the collaboration graph, use
        “Record graph evolution” under the network panel (GIF or WebM there). WebM uses the browser
        video encoder; GIF uses gifenc (palette from frame 0). Long runs produce large GIFs — lower
        ticks or fps if needed.
      </p>
    </div>
  );
}
