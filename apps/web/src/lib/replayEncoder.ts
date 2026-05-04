import { stockDistribution, type TickRecord } from "@ip-sim/core";
import GIFEncoder, { applyPalette, quantize } from "gifenc";

function giniReputationAt(h: TickRecord): number {
  const g = (h.metrics as { giniReputation?: number }).giniReputation;
  if (typeof g === "number" && Number.isFinite(g)) return g;
  const vals = h.agentSnapshots.map((a) => a.reputation ?? 0);
  return stockDistribution(vals).gini;
}

function totalReputationAt(h: TickRecord): number {
  const t = (h.metrics as { totalReputation?: number }).totalReputation;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  return h.agentSnapshots.reduce((s, a) => s + (a.reputation ?? 0), 0);
}

/** Pick a MIME type supported by MediaRecorder + canvas.captureStream in this browser. */
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

function metricsSeries(history: TickRecord[]) {
  return {
    gini: history.map((h) => h.metrics.giniWealth),
    power: history.map((h) => h.metrics.powerHHI),
    top10: history.map((h) => h.metrics.top10WealthShare),
    innov: history.map((h) => h.metrics.innovationFlow),
    giniRep: history.map((h) => giniReputationAt(h)),
    totalRep: history.map((h) => totalReputationAt(h)),
  };
}

function drawSparkline(
  ctx: CanvasRenderingContext2D,
  xs: number,
  xe: number,
  y0: number,
  y1: number,
  values: number[],
  upto: number,
  stroke: string,
) {
  const slice = values.slice(0, upto + 1);
  if (slice.length < 2) return;
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const pad = (max - min) * 0.08 || 1e-6;
  const lo = min - pad;
  const hi = max + pad;
  ctx.beginPath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  const n = slice.length;
  for (let i = 0; i < n; i++) {
    const px = xs + (i / Math.max(1, values.length - 1)) * (xe - xs);
    const py = y1 - ((slice[i]! - lo) / (hi - lo)) * (y1 - y0);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  const cx =
    xs + (upto / Math.max(1, values.length - 1)) * (xe - xs);
  const cv = slice[upto]!;
  const cy = y1 - ((cv - lo) / (hi - lo)) * (y1 - y0);
  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
}

export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  history: TickRecord[],
  tickIdx: number,
  subtitle: string,
): void {
  ctx.fillStyle = "#0d0d0f";
  ctx.fillRect(0, 0, width, height);

  const m = metricsSeries(history);
  const tick = history[tickIdx]?.metrics;

  ctx.fillStyle = "#e8e8ed";
  ctx.font = "600 28px ui-sans-serif, system-ui";
  ctx.fillText("IP · Sharing ABM — replay", 48, 52);

  ctx.font = "400 20px JetBrains Mono, ui-monospace";
  ctx.fillStyle = "#8a8f98";
  ctx.fillText(subtitle, 48, 84);

  ctx.fillStyle = "#fbbf24";
  ctx.font = "600 22px JetBrains Mono, ui-monospace";
  ctx.fillText(
    `Step ${tickIdx + 1} / ${history.length} · sim tick ${tick?.tick ?? "—"}`,
    48,
    118,
  );

  const rowH = (height - 168) / 6;
  const padX = 48;
  const chartW = width - padX * 2;
  const labels = [
    { key: "Gini wealth", series: m.gini, color: "#f472b6" },
    { key: "Gini reputation", series: m.giniRep, color: "#c4b5fd" },
    { key: "Σ reputation", series: m.totalRep, color: "#a78bfa" },
    { key: "Power HHI", series: m.power, color: "#60a5fa" },
    { key: "Top 10% wealth", series: m.top10, color: "#34d399" },
    { key: "Innovation flow", series: m.innov, color: "#fbbf24" },
  ] as const;

  labels.forEach((lab, i) => {
    const y0 = 150 + i * rowH;
    const y1 = y0 + rowH - 36;
    ctx.fillStyle = "#8a8f98";
    ctx.font = "14px JetBrains Mono, ui-monospace";
    ctx.fillText(lab.key, padX, y0 + 18);
    ctx.strokeStyle = "#2a2a32";
    ctx.strokeRect(padX, y0 + 28, chartW, y1 - y0 - 28);
    drawSparkline(
      ctx,
      padX + 4,
      padX + chartW - 4,
      y0 + 32,
      y1 - 4,
      lab.series,
      tickIdx,
      lab.color,
    );
    const v = lab.series[tickIdx];
    if (v !== undefined) {
      ctx.fillStyle = lab.color;
      ctx.font = "16px JetBrains Mono, ui-monospace";
      ctx.fillText(v.toFixed(4), padX + chartW - 160, y0 + 18);
    }
  });
}

/** Encode full timeline as WebM (VP8/VP9 if available). Returns null if unsupported. */
export async function encodeReplayWebm(
  history: TickRecord[],
  options: {
    fps?: number;
    subtitle?: string;
    width?: number;
    height?: number;
    onProgress?: (t: number, total: number) => void;
  } = {},
): Promise<Blob | null> {
  const fps = options.fps ?? 12;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const subtitle = options.subtitle ?? "";

  const mime = pickMime();
  if (!mime || typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const total = history.length;
  if (total === 0) return null;

  const frameMs = 1000 / fps;

  return new Promise((resolve) => {
    recorder.onstop = () => {
      resolve(chunks.length ? new Blob(chunks, { type: "video/webm" }) : null);
    };

    recorder.start(250);

    let frame = 0;
    const tick = () => {
      if (frame >= total) {
        setTimeout(() => recorder.stop(), Math.max(250, frameMs * 2));
        return;
      }
      drawReplayFrame(ctx, width, height, history, frame, subtitle);
      options.onProgress?.(frame + 1, total);
      frame++;
      setTimeout(tick, frameMs);
    };

    tick();
  });
}

/**
 * GIF with the same canvas frames as WebM export (metrics replay).
 * Uses one shared palette from the first frame for stable colors.
 */
export async function encodeReplayGif(
  history: TickRecord[],
  options: {
    fps?: number;
    subtitle?: string;
    width?: number;
    height?: number;
    onProgress?: (t: number, total: number) => void;
  } = {},
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const fps = options.fps ?? 12;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const subtitle = options.subtitle ?? "";
  const total = history.length;
  if (total === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const delayMs = Math.round(1000 / Math.max(1, fps));
  const gif = GIFEncoder();

  let sharedPalette: Uint32Array | null = null;

  for (let frame = 0; frame < total; frame++) {
    drawReplayFrame(ctx, width, height, history, frame, subtitle);

    const imageData = ctx.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data.buffer);

    if (frame === 0) {
      sharedPalette = quantize(rgba, 256);
    }
    const palette = sharedPalette as Uint32Array;
    const index = applyPalette(rgba, palette);

    gif.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
    });

    options.onProgress?.(frame + 1, total);

    if (frame % 8 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  gif.finish();
  const bytes = gif.bytes();
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}
