import type { AgentObservation, AgentState, PolicyVector, WorldState } from "./types.js";
import { effectiveStringencyFromState } from "./regulatory.js";

/**
 * Build the serializable observation passed to policies (heuristic, QRE, LLM).
 * Includes wealth, knowledge, labor, reputation, neighbors, policy snapshot, memory, last profit, offering quality, and pending R&D count.
 */
export function buildObservation(
  agent: AgentState,
  world: WorldState,
): AgentObservation {
  const neighbors: { id: string; weight: number }[] = [];
  for (const e of world.edges) {
    if (e.a === agent.id) neighbors.push({ id: e.b, weight: e.weight });
    else if (e.b === agent.id) neighbors.push({ id: e.a, weight: e.weight });
  }
  const reg = world.config.regulatory;
  const erosion = reg.bribe.corruptionErodesStringency;
  const eff = reg.enabled
    ? effectiveStringencyFromState(
        world.regulatory.stringency,
        world.regulatory.corruption,
        erosion,
      )
    : 0;
  const sp = world.config.spawn;
  const pop = world.agents.length;
  const need = sp.parentCostWealth + sp.minParentWealthFloor;
  return {
    selfId: agent.id,
    type: agent.type,
    civicRole: agent.civicRole,
    publicServantFireable: agent.publicServantFireable,
    tick: world.tick,
    wealth: agent.wealth,
    knowledge: agent.knowledge,
    labor: agent.labor,
    patentCount: agent.patentExpiresAt.length,
    reputation: agent.reputation,
    neighbors,
    globalPool: world.globalPool,
    marketSize: world.marketSize,
    policy: world.config.policy as PolicyVector,
    regulatory: {
      enabled: reg.enabled,
      ruleMode: reg.ruleMode,
      stringency: world.regulatory.stringency,
      corruption: world.regulatory.corruption,
      effectiveStringency: eff,
      bribeEnabled: reg.bribe.enabled,
    },
    memory: [...agent.memory],
    lastProfit: agent.lastProfit,
    lastOfferingQuality: agent.lastOfferingQuality,
    pendingInnovationCount: agent.innovationPipeline.length,
    population: pop,
    spawn: {
      enabled: sp.enabled,
      maxAgents: sp.maxAgents,
      atCap: pop >= sp.maxAgents,
      canAffordSpawn: sp.enabled && pop < sp.maxAgents && agent.wealth >= need,
    },
  };
}
