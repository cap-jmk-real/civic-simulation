import type { AgentState, SimConfig, WorldState } from "./types.js";
import { offeringQualityBranches } from "./production.js";

/** Clamp to [0, 1]. */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Effective enforcement after corruption erodes stringency.
 */
export function effectiveStringencyFromState(
  stringency: number,
  corruption: number,
  corruptionErodes: number,
): number {
  return clamp01(stringency * (1 - corruption * corruptionErodes));
}

/**
 * Signed social load: goods and services channel contributions from all agents’ branch qualities.
 */
export function computeNetExternalityLoad(
  agents: AgentState[],
  cfg: SimConfig,
): { goodsChannel: number; servicesChannel: number; netLoad: number } {
  const reg = cfg.regulatory;
  let goodsChannel = 0;
  let servicesChannel = 0;
  for (const ag of agents) {
    const { qGood, qServ } = offeringQualityBranches(ag, cfg);
    const gp = reg.goodsExternalityByProducer[ag.type] ?? 0;
    const sp = reg.servicesExternalityByProducer[ag.type] ?? 0;
    goodsChannel += qGood * gp;
    servicesChannel += qServ * sp;
  }
  return {
    goodsChannel,
    servicesChannel,
    netLoad: goodsChannel + servicesChannel,
  };
}

/**
 * Stringency used to mitigate **positive** net social harm this tick (fixed vs dynamic semantics).
 */
export function mitigationBaselineStringency(
  world: WorldState,
  cfg: SimConfig,
): number {
  const reg = cfg.regulatory;
  const ambition = clamp01(cfg.policy.regulatoryAmbition);
  const erosion = reg.bribe.corruptionErodesStringency;
  const corruptErosion = world.regulatory.corruption * erosion;
  if (reg.ruleMode === "fixed") {
    return clamp01(
      reg.baseStringency * (0.2 + 0.8 * ambition) * reg.policyScale * (1 - corruptErosion),
    );
  }
  return effectiveStringencyFromState(
    world.regulatory.stringency,
    world.regulatory.corruption,
    erosion,
  );
}

/** Update `world.regulatory.stringency` for the next tick (no-op if regulation disabled). */
export function advanceRegulatoryStringency(
  world: WorldState,
  cfg: SimConfig,
  rnd: () => number,
): void {
  const reg = cfg.regulatory;
  if (!reg.enabled) return;
  const ambition = clamp01(cfg.policy.regulatoryAmbition);
  const corruptErosion = world.regulatory.corruption * reg.bribe.corruptionErodesStringency;
  if (reg.ruleMode === "fixed") {
    world.regulatory.stringency = clamp01(
      reg.baseStringency * (0.2 + 0.8 * ambition) * reg.policyScale * (1 - corruptErosion),
    );
    return;
  }
  const attractor = clamp01(
    reg.baseStringency * (0.2 + 0.8 * ambition) * reg.policyScale * (1 - corruptErosion),
  );
  const noise = (rnd() - 0.5) * 2 * reg.dynamicNoise;
  world.regulatory.stringency = clamp01(
    world.regulatory.stringency * reg.dynamicPersistence +
      (1 - reg.dynamicPersistence) * attractor +
      noise,
  );
}
