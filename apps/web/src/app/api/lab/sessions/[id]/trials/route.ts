import { NextResponse } from "next/server";
import { z } from "zod";
import { getLabSession, listLabTrials, upsertLabTrial } from "@/lib/simQueue/labSessionsStore";
import { toOptimizationTrialSummary } from "@/lib/simQueue/optimizationTrialSummary";

export const runtime = "nodejs";

const postSchema = z.object({
  trialId: z.string().min(1),
  generation: z.number().int(),
  evaluationIndex: z.number().int(),
  assignments: z.unknown(),
  metricValue: z.number().nullable(),
  mse: z.number(),
  elapsedMs: z.number().nullable().optional(),
  isNewBest: z.boolean(),
  runSummaryJson: z.string(),
  fullRunJson: z.string().nullable().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = getLabSession(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.session_type !== "optimization") {
      return NextResponse.json({ error: "Session is not optimization" }, { status: 400 });
    }
    const trials = listLabTrials(id, 5000).map(toOptimizationTrialSummary);
    return NextResponse.json({ trials });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: sessionId } = await ctx.params;
    const sess = getLabSession(sessionId);
    if (!sess) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (sess.session_type !== "optimization") {
      return NextResponse.json({ error: "Session is not optimization" }, { status: 400 });
    }
    const json = (await req.json()) as unknown;
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const b = parsed.data;
    upsertLabTrial({
      sessionId,
      trialId: b.trialId,
      generation: b.generation,
      evaluationIndex: b.evaluationIndex,
      assignmentsJson: JSON.stringify(b.assignments),
      metricValue: b.metricValue,
      mse: b.mse,
      elapsedMs: b.elapsedMs ?? null,
      isNewBest: b.isNewBest,
      runSummaryJson: b.runSummaryJson,
      fullRunJson: b.fullRunJson ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
