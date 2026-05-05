import { NextResponse } from "next/server";
import { z } from "zod";
import { createBackendLogger } from "@/lib/backendLogger";
import { jobRowToDetailApiJson } from "@/lib/simQueue/jobDetailForApi";
import { getJob, tryCancelJob } from "@/lib/simQueue/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.literal("cancel"),
});
const logger = createBackendLogger("queue-api");

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const row = getJob(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(jobRowToDetailApiJson(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function cancelJob(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const json = (await req.json()) as unknown;
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const result = tryCancelJob(id);
    if (result === "not_found") {
      logger.warn("Cancel requested for missing job", { id });
      return NextResponse.json({ error: "Not found", cancelled: false }, { status: 404 });
    }
    if (result === "already_terminal") {
      logger.warn("Cancel ignored for terminal job", { id });
      return NextResponse.json(
        { error: "Job is already terminal", cancelled: false },
        { status: 409 },
      );
    }
    logger.info("Cancelled job", { id });
    return NextResponse.json({ cancelled: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Cancel failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cancelJob(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cancelJob(req, ctx);
}
