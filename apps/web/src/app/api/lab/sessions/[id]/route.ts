import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeLabSession,
  countLabBatchCells,
  countLabTrials,
  getLabSession,
  tryCancelLabSession,
} from "@/lib/simQueue/labSessionsStore";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.enum(["complete", "cancelled"]),
  bestTrialId: z.string().nullable().optional(),
});
const postSchema = z.object({
  action: z.literal("cancel"),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = getLabSession(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      session: {
        id: row.id,
        sessionType: row.session_type,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        heartbeatAt: row.heartbeat_at,
        statusNote: row.status_note,
        projectId: row.project_id,
        bestTrialId: row.best_trial_id,
        meta: safeJson(row.meta_json),
        trialCount: row.session_type === "optimization" ? countLabTrials(id) : 0,
        cellCount: row.session_type === "grid_batch" ? countLabBatchCells(id) : 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = getLabSession(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const json = (await req.json()) as unknown;
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { status, bestTrialId } = parsed.data;
    completeLabSession(id, status, bestTrialId !== undefined ? bestTrialId : undefined);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const json = (await req.json()) as unknown;
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const result = tryCancelLabSession(id);
    if (result === "not_found") return NextResponse.json({ error: "Not found", cancelled: false }, { status: 404 });
    if (result === "already_terminal") {
      return NextResponse.json(
        { error: "Lab session is already terminal", cancelled: false },
        { status: 409 },
      );
    }
    return NextResponse.json({ cancelled: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
