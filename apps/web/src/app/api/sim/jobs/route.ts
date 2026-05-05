import { mergeSimConfig, type SimConfig } from "@ip-sim/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createBackendLogger } from "@/lib/backendLogger";
import { listRecentJobSummaries } from "@/lib/simQueue/jobListSummary";
import { insertQueuedJob } from "@/lib/simQueue/store";
import type { SimJobPayload } from "@/lib/simQueue/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postBodySchema = z.object({
  config: z.record(z.unknown()),
  policyMode: z.enum(["heuristic", "qre"]),
  qreTemp: z.number().optional(),
});
const logger = createBackendLogger("queue-api");

export async function GET() {
  try {
    return NextResponse.json({ jobs: listRecentJobSummaries(50) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("List jobs failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as unknown;
    const parsed = postBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { config, policyMode, qreTemp } = parsed.data;
    try {
      mergeSimConfig(config as Parameters<typeof mergeSimConfig>[0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Invalid sim config: ${msg}` }, { status: 400 });
    }
    const payload: SimJobPayload = {
      config: config as Partial<SimConfig>,
      policyMode,
      qreTemp: policyMode === "qre" ? qreTemp ?? 0.65 : undefined,
    };
    const id = insertQueuedJob(payload);
    logger.info("Enqueued job", {
      id,
      policyMode,
      ticks: typeof payload.config.ticks === "number" ? payload.config.ticks : undefined,
    });
    return NextResponse.json({
      id,
      streamUrl: "/api/sim/stream",
      jobStreamUrl: `/api/sim/jobs/${encodeURIComponent(id)}/stream`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("Enqueue failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
