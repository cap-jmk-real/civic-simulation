import type { Action, AgentState, WorldState } from "../types.js";
import { buildObservation } from "../observe.js";

/**
 * Rule-based baseline policy: type-specific heuristics over {@link buildObservation} (wealth, policy, neighbors).
 * Uses deterministic `rndDet` from agent id + tick so runs don’t need a shared RNG for this policy alone.
 */
export function heuristicPolicy(agent: AgentState, world: WorldState): Action {
  const o = buildObservation(agent, world);
  const p = o.policy;
  const lowCash = o.wealth < 25;

  if (agent.type === "academic") {
    if (p.openScienceSubsidy > 0.25 && !lowCash) return "publish_open";
    if (rndDet(agent.id, world.tick) < 0.35) return "invest_rnd";
    return "publish_open";
  }

  if (agent.type === "bigco") {
    if (
      o.spawn.enabled &&
      o.spawn.canAffordSpawn &&
      !o.spawn.atCap &&
      o.wealth > 90 &&
      rndDet(agent.id, world.tick + 19) < 0.06
    )
      return "spawn_agent";
    if (
      o.regulatory.enabled &&
      world.config.regulatory.bribe.enabled &&
      o.wealth > 55 &&
      rndDet(agent.id, world.tick + 11) < 0.08
    )
      return "bribe_regulator";
    if (p.patentRegime !== "none" && o.patentCount < 3 && o.wealth > 40 && rndDet(agent.id, world.tick) < 0.22)
      return "file_patent";
    if (rndDet(agent.id, world.tick + 1) < 0.45) return "invest_rnd";
    if (p.enforcementIntensity > 0.4 && o.reputation > 1.3 && rndDet(agent.id, world.tick + 2) < 0.15)
      return "enforce_ip";
    if (p.enforcementIntensity > 0.4 && rndDet(agent.id, world.tick + 2) < 0.12) return "enforce_ip";
    return "idle";
  }

  if (agent.type === "smb") {
    if (
      o.spawn.enabled &&
      o.spawn.canAffordSpawn &&
      !o.spawn.atCap &&
      o.wealth > 70 &&
      rndDet(agent.id, world.tick + 18) < 0.07
    )
      return "spawn_agent";
    if (
      o.regulatory.enabled &&
      world.config.regulatory.bribe.enabled &&
      o.wealth > 45 &&
      rndDet(agent.id, world.tick + 12) < 0.05
    )
      return "bribe_regulator";
    if (!lowCash && o.neighbors.length > 0 && rndDet(agent.id, world.tick + 8) < 0.12)
      return "trade";
    if (!lowCash && rndDet(agent.id, world.tick) < 0.25) return "collaborate";
    return rndDet(agent.id, world.tick + 3) < 0.55 ? "invest_rnd" : "idle";
  }

  // solo
  if (!lowCash && o.neighbors.length > 0 && rndDet(agent.id, world.tick + 9) < 0.14)
    return "trade";
  if (!lowCash && rndDet(agent.id, world.tick) < 0.3) return "collaborate";
  return rndDet(agent.id, world.tick + 4) < 0.6 ? "invest_rnd" : "publish_open";
}

/** Deterministic pseudo-random in [0,1) from strings/tick — no shared RNG needed for policy. */
function rndDet(id: string, tick: number): number {
  let h = tick * 2654435761 + id.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  h ^= h << 13;
  h ^= h >>> 7;
  h ^= h << 17;
  return (h >>> 0) / 4294967296;
}
