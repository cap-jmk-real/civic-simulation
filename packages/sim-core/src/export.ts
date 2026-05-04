import type { SimulationRun } from "./types.js";

/** Pretty-print a {@link SimulationRun} to JSON (2-space indent). */
export function serializeRun(run: SimulationRun): string {
  return JSON.stringify(run, null, 2);
}

/**
 * Parse JSON into a {@link SimulationRun}. Does not validate schema; invalid files may break at runtime.
 */
export function parseRun(json: string): SimulationRun {
  return JSON.parse(json) as SimulationRun;
}
