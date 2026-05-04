import type { TickMetrics, TickRecord } from "@ip-sim/core";

/**
 * Raw innovation flow for a tick record. Prefers {@link TickMetrics.innovationFlow}; falls back
 * to `innovation_flow` when metrics were deserialized from Rust/serde JSON (snake_case).
 */
export function innovationFlowAtTick(h: TickRecord): number {
  const m = h.metrics as TickMetrics & { innovation_flow?: number };
  const v = m.innovation_flow ?? m.innovationFlow;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return Number.NaN;
}

/**
 * Per-capita wealth at a tick: `metrics.meanWealth` when present, else
 * `totalWealth / agentCount` (same definition as {@link TickMetrics.meanWealth} in sim-core).
 * Comparable across population sizes — “wealth normalized” in the batch/results UI.
 */
export function meanWealthAtTick(h: TickRecord): number {
  const m = h.metrics;
  if (typeof m.meanWealth === "number" && Number.isFinite(m.meanWealth)) return m.meanWealth;
  const n = m.agentCount ?? h.agentSnapshots.length ?? 1;
  return m.totalWealth / Math.max(1, n);
}

/**
 * Innovation throughput scaled by cohort size: `innovationFlow / agentCount` for the tick.
 * Aligns per-capita interpretation with mean wealth when comparing grids with varying N.
 */
export function innovationFlowPerAgentAtTick(h: TickRecord): number {
  const flow = innovationFlowAtTick(h);
  const m = h.metrics;
  const n = m.agentCount ?? h.agentSnapshots.length ?? 1;
  return flow / Math.max(1, n);
}
