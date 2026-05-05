import { NextResponse } from "next/server";
import { getLabSession, getLabTrial } from "@/lib/simQueue/labSessionsStore";
import { resolveLabTrialFullRunJson } from "@/lib/simQueue/labRunJsonResolver";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; trialId: string }> },
) {
  try {
    const { id: sessionId, trialId } = await ctx.params;
    const session = getLabSession(sessionId);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.session_type !== "optimization") {
      return NextResponse.json({ error: "Session is not optimization" }, { status: 400 });
    }
    const trial = getLabTrial(sessionId, trialId);
    if (!trial) return NextResponse.json({ error: "Trial not found" }, { status: 404 });

    let assignments: unknown = [];
    try {
      assignments = JSON.parse(trial.assignments_json) as unknown;
    } catch {
      assignments = [];
    }

    const fullRunJson = resolveLabTrialFullRunJson({
      runSummaryJson: trial.run_summary_json,
      spilloverPath: trial.spillover_path,
    });

    return NextResponse.json({
      trial: {
        id: trial.id,
        sessionId: trial.session_id,
        generation: trial.generation,
        evaluationIndex: trial.evaluation_index,
        metricValue: trial.metric_value,
        mse: trial.mse,
        finishedAt: trial.created_at,
        assignments,
        fullRunJson,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
