import { NextResponse } from "next/server";
import { listLabEvalEvents } from "@/lib/simQueue/labSessionsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const events = listLabEvalEvents(id, 200);

    if (events.length === 0) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }

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
  } catch (err: unknown) {
    const msg = (err as { message?: string } | null | undefined)?.message ?? String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

