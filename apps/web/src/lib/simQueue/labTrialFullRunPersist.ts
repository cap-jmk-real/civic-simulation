import { serializeRun, type SimulationRun, type WorldState } from "@ip-sim/core";

/**
 * Serialize a full simulation run for lab trial persistence so Optimize can preview **any**
 * finished evaluation (not only the current best). Large JSON is spilled to disk by
 * `mergeRunSummaryWithOptionalFullRun` in `labSessionsStore`.
 */
export function fullRunJsonForLabTrialPersist(run: SimulationRun & { finalWorld?: WorldState }): string | null {
  if (!run || !Array.isArray(run.history) || run.history.length === 0) {
    return null;
  }
  try {
    return serializeRun(run);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[labTrialFullRunPersist] serializeRun failed", {
      error: e.message,
      stack: e.stack,
      manifest: (run as unknown as { manifest?: unknown }).manifest ?? null,
      historyLen: Array.isArray(run.history) ? run.history.length : null,
    });
    return null;
  }
}
