import { parseRun, type SimConfig, type SimulationRun, type WorldState } from "@ip-sim/core";

/**
 * Full heuristic ABM run via Rust (`ip-sim-wasm` → `ip-sim-engine`).
 * JSON shape matches `runSimulationSync` from `@ip-sim/core`.
 * From the host page this is one synchronous WASM call per run unless you add workers yourself.
 */
export async function runSimulationHeuristicWasm(
  config: SimConfig,
): Promise<SimulationRun & { finalWorld: WorldState }> {
  const wasm = await import("@ip-sim/wasm");
  const json = wasm.run_simulation_heuristic_json(JSON.stringify(config));
  return parseRun(json) as SimulationRun & { finalWorld: WorldState };
}
