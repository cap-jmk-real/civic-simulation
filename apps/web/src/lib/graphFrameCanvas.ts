import type { AgentState, Edge } from "@ip-sim/core";
import { nodeFillAndStroke, useCivicPrimaryPalette } from "@/lib/graphStyle";

export function drawGraphFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  agents: AgentState[],
  edges: Edge[],
  positions: Record<string, { x: number; y: number }>,
  header: string,
  subheader?: string,
): void {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, width, height);

  const civicPrimary = useCivicPrimaryPalette(agents);

  for (const e of edges) {
    const pa = positions[e.a];
    const pb = positions[e.b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.strokeStyle = "rgba(63,63,70,0.72)";
    ctx.lineWidth = Math.min(3, 0.45 + e.weight);
    ctx.stroke();
  }

  for (const a of agents) {
    const p = positions[a.id];
    if (!p) continue;
    const r = 6 + Math.sqrt(Math.max(0, a.wealth)) * 0.22;
    const { fill, stroke, strokeWidth } = nodeFillAndStroke(a, civicPrimary);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.94;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (strokeWidth > 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#e8e8ed";
  ctx.font = "600 15px ui-sans-serif, system-ui";
  ctx.fillText(header, 14, 22);
  if (subheader) {
    ctx.fillStyle = "#8a8f98";
    ctx.font = "12px JetBrains Mono, ui-monospace, monospace";
    ctx.fillText(subheader, 14, 40);
  }
}
