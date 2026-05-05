import { NextResponse } from "next/server";
import { z } from "zod";
import { getLabSession, listLabBatchCells, upsertLabBatchCell } from "@/lib/simQueue/labSessionsStore";
import { toLabBatchCellSummary } from "@/lib/simQueue/labBatchCellSummary";

export const runtime = "nodejs";

const postSchema = z.object({
  rowId: z.string().min(1),
  cellIndex: z.number().int(),
  cellClientId: z.string().nullable(),
  label: z.string().nullable(),
  assignments: z.unknown(),
  runSummaryJson: z.string(),
  fullRunJson: z.string().nullable().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = getLabSession(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.session_type !== "grid_batch") {
      return NextResponse.json({ error: "Session is not grid_batch" }, { status: 400 });
    }
    const cells = listLabBatchCells(id, 5000).map(toLabBatchCellSummary);
    return NextResponse.json({ cells });
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
    if (sess.session_type !== "grid_batch") {
      return NextResponse.json({ error: "Session is not grid_batch" }, { status: 400 });
    }
    const json = (await req.json()) as unknown;
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const b = parsed.data;
    upsertLabBatchCell({
      sessionId,
      rowId: b.rowId,
      cellIndex: b.cellIndex,
      cellClientId: b.cellClientId,
      label: b.label,
      assignmentsJson: JSON.stringify(b.assignments),
      runSummaryJson: b.runSummaryJson,
      fullRunJson: b.fullRunJson ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
