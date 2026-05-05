import { NextResponse } from "next/server";
import { z } from "zod";
import {
  countLabBatchCells,
  countLabTrials,
  listLabSessions,
  upsertLabSession,
} from "@/lib/simQueue/labSessionsStore";
import { getSimQueueDbPath } from "@/lib/simQueue/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.object({
  id: z.string().min(4),
  sessionType: z.enum(["optimization", "grid_batch"]),
  status: z.enum(["queued", "running"]).optional(),
  projectId: z.string().nullable().optional(),
  meta: z.unknown().optional(),
});

export async function GET() {
  try {
    const sessions = listLabSessions(50);
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        sessionType: s.session_type,
        status: s.status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        heartbeatAt: s.heartbeat_at,
        statusNote: s.status_note,
        projectId: s.project_id,
        bestTrialId: s.best_trial_id,
        meta: safeJson(s.meta_json),
        trialCount: s.session_type === "optimization" ? countLabTrials(s.id) : 0,
        cellCount: s.session_type === "grid_batch" ? countLabBatchCells(s.id) : 0,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/lab/sessions] GET failed", {
      error: e,
      message: msg,
      dbPath: getSimQueueDbPath(),
      cwd: process.cwd(),
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as unknown;
    const parsed = postSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { id, sessionType, status, projectId, meta } = parsed.data;
    const effectiveStatus = status ?? (sessionType === "optimization" ? "queued" : "running");
    upsertLabSession({
      id,
      sessionType,
      projectId: projectId ?? null,
      meta: meta ?? {},
      status: effectiveStatus,
    });
    if (sessionType === "optimization") {
      console.info("[api/lab/sessions] optimization enqueued", {
        id,
        status: effectiveStatus,
        dbPath: getSimQueueDbPath(),
        cwd: process.cwd(),
      });
    }
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/lab/sessions] POST failed", {
      error: e,
      message: msg,
      dbPath: getSimQueueDbPath(),
      cwd: process.cwd(),
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeJson(raw: string | null | undefined): unknown {
  if (raw == null || raw === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}
