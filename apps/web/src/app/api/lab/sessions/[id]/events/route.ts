import { NextResponse } from "next/server";
import { listLabEvalEvents } from "@/lib/simQueue/labSessionsStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const events = listLabEvalEvents(id, 200);
  return NextResponse.json(
    {
      sessionId: id,
      events: events.map((e) => ({
        id: e.id,
        type: e.event_type,
        generation: e.generation,
        evaluationIndex: e.evaluation_index,
        ts: e.ts,
        elapsedMs: e.elapsed_ms,
        metricValue: e.metric_value,
        mse: e.mse,
        isNewBest: e.is_new_best === 1,
        detail: e.detail_json ? safeJson(e.detail_json) : null,
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

