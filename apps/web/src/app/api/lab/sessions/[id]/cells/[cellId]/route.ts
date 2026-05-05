import { NextResponse } from "next/server";
import { getLabBatchCell, getLabSession } from "@/lib/simQueue/labSessionsStore";
import { resolveLabBatchCellFullRunJson } from "@/lib/simQueue/labRunJsonResolver";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; cellId: string }> },
) {
  try {
    const { id: sessionId, cellId } = await ctx.params;
    const session = getLabSession(sessionId);
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (session.session_type !== "grid_batch") {
      return NextResponse.json({ error: "Session is not grid_batch" }, { status: 400 });
    }
    const cell = getLabBatchCell(sessionId, cellId);
    if (!cell) return NextResponse.json({ error: "Cell not found" }, { status: 404 });

    let assignments: unknown = [];
    try {
      assignments = JSON.parse(cell.assignments_json) as unknown;
    } catch {
      assignments = [];
    }

    const fullRunJson = resolveLabBatchCellFullRunJson({
      runSummaryJson: cell.run_summary_json,
      spilloverPath: cell.spillover_path,
    });

    return NextResponse.json({
      cell: {
        id: cell.id,
        sessionId: cell.session_id,
        cellIndex: cell.cell_index,
        cellClientId: cell.cell_client_id,
        label: cell.label,
        finishedAt: cell.created_at,
        assignments,
        fullRunJson,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
