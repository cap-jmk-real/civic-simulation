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
  } catch {
    return null;
  }
}
