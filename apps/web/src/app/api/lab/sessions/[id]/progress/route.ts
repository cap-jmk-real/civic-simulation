import { NextResponse } from "next/server";
import { getLabSession, getOptimizationTrialProgress, heartbeatLabSession } from "@/lib/simQueue/labSessionsStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const session = getLabSession(id);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.session_type !== "optimization") {
      return NextResponse.json({ error: "Session is not optimization" }, { status: 400 });
    }
    if (session.status === "running") {
      heartbeatLabSession(id, "heartbeat via progress poll");
    }
    const progress = getOptimizationTrialProgress(id);
    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      progress: progress
        ? {
            evaluationIndex: progress.evaluation_index,
            generation: progress.generation,
            trialCount: progress.trial_count,
          }
        : null,
    }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
