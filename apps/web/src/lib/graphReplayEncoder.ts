import type { AgentState, Edge, SimulationRun, TickRecord, WorldState } from "@ip-sim/core";
import GIFEncoder, { applyPalette, quantize } from "gifenc";
import { computeForceLayout } from "@/lib/graphLayout";
import { drawGraphFrame } from "@/lib/graphFrameCanvas";
import { mergeAgentsWithTickSnapshot } from "@/lib/mergeAgentsAtTick";
import { subsampleGraphForLayout } from "@/lib/graphSample";

function pickMime(): string | undefined {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

/** Evenly sample tick indices in [start, end] with at most `maxFrames` samples. */
export function sampleTickIndices(
  start: number,
  end: number,
  maxFrames: number,
): number[] {
  if (end < start || maxFrames < 1) return [];
  const span = end - start + 1;
  if (span <= maxFrames) {
    return Array.from({ length: span }, (_, i) => start + i);
  }
  const out: number[] = [];
  for (let f = 0; f < maxFrames; f++) {
    const t =
      start + Math.round((f / Math.max(1, maxFrames - 1)) * (end - start));
    out.push(t);
  }
  return out;
}

function applyLayoutSubsample(
  agents: AgentState[],
  edges: Edge[],
  layoutSeed: number,
  lockedIds: Set<string> | null,
): ReturnType<typeof subsampleGraphForLayout> {
  if (!lockedIds) {
    return subsampleGraphForLayout(agents, edges, layoutSeed);
  }
  const subAgents = agents.filter((a) => lockedIds.has(a.id));
  const subEdges = edges.filter((e) => lockedIds.has(e.a) && lockedIds.has(e.b));
  return {
    agents: subAgents,
    edges: subEdges,
    sampled: true,
    totalAgents: agents.length,
  };
}

function augmentPositions(
  base: Record<string, { x: number; y: number }>,
  agents: AgentState[],
  width: number,
  height: number,
  salt: number,
): Record<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const next = { ...base };
  let i = 0;
  for (const a of agents) {
    if (next[a.id]) continue;
    const angle = (((salt + i * 17) % 360) / 360) * Math.PI * 2;
    const rad = 40 + (i % 8) * 12;
    next[a.id] = {
      x: cx + Math.cos(angle) * rad,
      y: cy + Math.sin(angle) * rad,
    };
    i++;
  }
  return next;
}

export type GraphEvolutionEncodeOptions = {
  fps?: number;
  width?: number;
  height?: number;
  startTick?: number;
  endTick?: number;
  maxFrames?: number;
  /** Same seed as the interactive graph (`config.seed`) for matching subsample/layout. */
  layoutSeed: number;
  subtitle?: string;
  onProgress?: (done: number, total: number) => void;
};

/**
 * GIF of the collaboration graph across sampled ticks (layout fixed from first sampled frame).
 * Yields to the event loop periodically so the tab stays responsive.
 */
export async function encodeGraphEvolutionGif(
  history: TickRecord[],
  finalAgents: AgentState[],
  options: GraphEvolutionEncodeOptions,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const fps = options.fps ?? 8;
  const width = options.width ?? 720;
  const height = options.height ?? 420;
  const start = Math.max(0, options.startTick ?? 0);
  const end = Math.min(
    history.length - 1,
    Math.max(start, options.endTick ?? history.length - 1),
  );
  const maxFrames = Math.max(1, options.maxFrames ?? 72);
  const tickIdxs = sampleTickIndices(start, end, maxFrames);
  if (tickIdxs.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const layoutSeed = options.layoutSeed >>> 0;
  const first = history[tickIdxs[0]!]!;
  const mergedFirst = mergeAgentsWithTickSnapshot(finalAgents, first);
  const sub0 = subsampleGraphForLayout(mergedFirst, first.edges, layoutSeed);
  const lockedIds: Set<string> | null = sub0.sampled
    ? new Set(sub0.agents.map((a) => a.id))
    : null;
  let positions = computeForceLayout(
    sub0.agents,
    sub0.edges,
    width,
    height,
  );

  const delayMs = Math.round(1000 / Math.max(1, fps));
  const gif = GIFEncoder();
  let sharedPalette: Uint32Array | null = null;
  const subtitle = options.subtitle ?? "";

  for (let fi = 0; fi < tickIdxs.length; fi++) {
    const ti = tickIdxs[fi]!;
    const rec = history[ti]!;
    const merged = mergeAgentsWithTickSnapshot(finalAgents, rec);
    const sub = applyLayoutSubsample(merged, rec.edges, layoutSeed, lockedIds);
    positions = augmentPositions(positions, sub.agents, width, height, fi);

    const header = `Graph · tick ${rec.metrics.tick} (${ti + 1}/${history.length})`;
    drawGraphFrame(ctx, width, height, sub.agents, sub.edges, positions, header, subtitle);

    const imageData = ctx.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data.buffer);
    if (fi === 0) {
      sharedPalette = quantize(rgba, 256);
    }
    const palette = sharedPalette as Uint32Array;
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay: delayMs });

    options.onProgress?.(fi + 1, tickIdxs.length);
    if (fi % 4 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

/** WebM of the same graph frames (smaller files for long spans). */
export async function encodeGraphEvolutionWebm(
  history: TickRecord[],
  finalAgents: AgentState[],
  options: GraphEvolutionEncodeOptions,
): Promise<Blob | null> {
  const fps = options.fps ?? 8;
  const width = options.width ?? 720;
  const height = options.height ?? 420;
  const start = Math.max(0, options.startTick ?? 0);
  const end = Math.min(
    history.length - 1,
    Math.max(start, options.endTick ?? history.length - 1),
  );
  const maxFrames = Math.max(1, options.maxFrames ?? 72);
  const tickIdxs = sampleTickIndices(start, end, maxFrames);
  if (tickIdxs.length === 0) return null;

  const mime = pickMime();
  if (!mime || typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const layoutSeed = options.layoutSeed >>> 0;
  const first = history[tickIdxs[0]!]!;
  const mergedFirst = mergeAgentsWithTickSnapshot(finalAgents, first);
  const sub0 = subsampleGraphForLayout(mergedFirst, first.edges, layoutSeed);
  const lockedIds: Set<string> | null = sub0.sampled
    ? new Set(sub0.agents.map((a) => a.id))
    : null;
  let positions = computeForceLayout(
    sub0.agents,
    sub0.edges,
    width,
    height,
  );

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 1_800_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const frameMs = 1000 / fps;
  const subtitle = options.subtitle ?? "";

  return new Promise((resolve) => {
    recorder.onstop = () => {
      resolve(chunks.length ? new Blob(chunks, { type: "video/webm" }) : null);
    };
    recorder.start(250);

    let fi = 0;
    const tick = () => {
      if (fi >= tickIdxs.length) {
        setTimeout(() => recorder.stop(), Math.max(250, frameMs * 2));
        return;
      }
      const ti = tickIdxs[fi]!;
      const rec = history[ti]!;
      const merged = mergeAgentsWithTickSnapshot(finalAgents, rec);
      const sub = applyLayoutSubsample(merged, rec.edges, layoutSeed, lockedIds);
      positions = augmentPositions(positions, sub.agents, width, height, fi);
      const header = `Graph · tick ${rec.metrics.tick} (${ti + 1}/${history.length})`;
      drawGraphFrame(ctx, width, height, sub.agents, sub.edges, positions, header, subtitle);
      options.onProgress?.(fi + 1, tickIdxs.length);
      fi++;
      setTimeout(tick, frameMs);
    };
    tick();
  });
}

export function graphExportDefaultRange(run: SimulationRun & { finalWorld?: WorldState }): {
  start: number;
  end: number;
} {
  const n = run.history.length;
  if (n === 0) return { start: 0, end: 0 };
  return { start: 0, end: n - 1 };
}
