import type { AgentState, TickRecord } from "@ip-sim/core";

/** Merge live `AgentState` with per-tick snapshot fields (same rules as the lab playhead). */
export function mergeAgentsWithTickSnapshot(
  finalAgents: AgentState[],
  tick: TickRecord,
): AgentState[] {
  const snap = new Map(tick.agentSnapshots.map((s) => [s.id, s]));
  return finalAgents.map((a) => {
    const s = snap.get(a.id);
    if (!s) return a;
    return {
      ...a,
      civicRole: s.civicRole ?? a.civicRole,
      publicServantFireable: s.publicServantFireable ?? a.publicServantFireable,
      wealth: s.wealth,
      knowledge: s.knowledge,
      labor: s.labor ?? a.labor,
      lastOfferingQuality: s.offeringQuality ?? a.lastOfferingQuality,
      reputation: s.reputation ?? a.reputation,
      patentExpiresAt: Array.from(
        { length: s.patentCount },
        (_, i) => tick.metrics.tick + i,
      ),
    };
  });
}
