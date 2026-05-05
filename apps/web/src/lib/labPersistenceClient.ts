"use client";

import { serializeRun, type SimulationRun, type WorldState } from "@ip-sim/core";

/** Matches {@link SIM_RESULT_JSON_MAX_BYTES} in simQueue store (inline JSON before spillover). */
export const LAB_PERSIST_INLINE_MAX_BYTES = 2 * 1024 * 1024;

export function buildCompactRunSummaryJson(run: SimulationRun & { finalWorld?: WorldState }): string {
  const last = run.history[run.history.length - 1];
  return JSON.stringify({
    tickCount: run.history.length,
    seed: run.manifest.seed,
    finalTick: last
      ? {
          tick: last.metrics.tick,
          metrics: { ...last.metrics },
        }
      : null,
  });
}

/** Returns full serialized run JSON only if under inline cap (else omit — server stores summary only). */
export function optionalFullRunJsonUnderCap(run: SimulationRun & { finalWorld?: WorldState }): string | null {
  // Cheap guard to avoid expensive serialization attempts for obviously large runs.
  const tickCount = Array.isArray(run.history) ? run.history.length : 0;
  const cfg = run.manifest?.config;
  const approxAgentCount =
    cfg && typeof cfg === "object" && cfg.agentCounts && typeof cfg.agentCounts === "object"
      ? Object.values(cfg.agentCounts as Record<string, unknown>).reduce<number>((sum, v) => {
          const n = typeof v === "number" ? v : 0;
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0)
      : 0;
  // Empirical payload proxy: snapshot-rich runs grow quickly with ticks × agents.
  if (tickCount * Math.max(1, approxAgentCount) > 120_000) {
    return null;
  }
  try {
    const s = serializeRun(run);
    const n = new TextEncoder().encode(s).length;
    if (n <= LAB_PERSIST_INLINE_MAX_BYTES) return s;
  } catch {
    /* ignore */
  }
  return null;
}

function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function persistLabSessionCreate(input: {
  id: string;
  sessionType: "optimization" | "grid_batch";
  status?: "queued" | "running";
  projectId?: string | null;
  meta: unknown;
}): Promise<void> {
  const res = await postJson("/api/lab/sessions", input);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    console.error("[lab persist] session create failed:", j.error ?? res.statusText);
  }
}

export async function persistLabTrial(input: {
  sessionId: string;
  trialId: string;
  generation: number;
  evaluationIndex: number;
  assignments: unknown;
  metricValue: number | null;
  mse: number;
  elapsedMs?: number | null;
  isNewBest: boolean;
  runSummaryJson: string;
  fullRunJson?: string | null;
}): Promise<void> {
  const res = await postJson(`/api/lab/sessions/${encodeURIComponent(input.sessionId)}/trials`, input);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    console.error("[lab persist] trial failed:", j.error ?? res.statusText);
  }
}

export async function persistLabBatchCell(input: {
  sessionId: string;
  rowId: string;
  cellIndex: number;
  cellClientId: string | null;
  label: string | null;
  assignments: unknown;
  runSummaryJson: string;
  fullRunJson?: string | null;
}): Promise<void> {
  const res = await postJson(`/api/lab/sessions/${encodeURIComponent(input.sessionId)}/cells`, input);
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    console.error("[lab persist] grid cell failed:", j.error ?? res.statusText);
  }
}

export async function persistLabSessionComplete(input: {
  sessionId: string;
  status: "complete" | "cancelled";
  bestTrialId?: string | null;
}): Promise<void> {
  const res = await fetch(`/api/lab/sessions/${encodeURIComponent(input.sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: input.status,
      bestTrialId: input.bestTrialId ?? null,
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    console.error("[lab persist] session complete failed:", j.error ?? res.statusText);
  }
}
