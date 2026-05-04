import type { AgentType, SimConfig } from "./types.js";

const EPS = 1e-9;

/**
 * CES aggregator: A [ α K^ρ + (1-α) L^ρ ]^(1/ρ).
 * ρ → 0 uses Cobb–Douglas limit K^α L^(1-α).
 */
export function cesAggregate(
  knowledge: number,
  labor: number,
  alpha: number,
  rho: number,
  scale: number,
): number {
  const K = Math.max(EPS, knowledge);
  const L = Math.max(EPS, labor);
  const a = Math.min(1, Math.max(0, alpha));
  const r = rho;
  if (Math.abs(r) < 1e-10) {
    return scale * Math.pow(K, a) * Math.pow(L, 1 - a);
  }
  const inner = a * Math.pow(K, r) + (1 - a) * Math.pow(L, r);
  return scale * Math.pow(Math.max(EPS, inner), 1 / r);
}

/** Type tilt: how labor splits between goods vs services capacity (per actor kind). */
export function serviceLaborShare(agentType: AgentType): number {
  switch (agentType) {
    case "academic":
      return 0.72;
    case "solo":
      return 0.55;
    case "smb":
      return 0.42;
    case "bigco":
      return 0.28;
    default:
      return 0.45;
  }
}

/**
 * Branch qualities and blended offering quality (used for CES revenue and regulatory externality channels).
 */
export function offeringQualityBranches(
  agent: {
    type: AgentType;
    knowledge: number;
    labor: number;
  },
  cfg: SimConfig,
): { qGood: number; qServ: number; q: number } {
  if (!cfg.cesQualityEnabled) {
    return { qGood: 1, qServ: 1, q: 1 };
  }
  const s = serviceLaborShare(agent.type);
  const L = Math.max(0, agent.labor);
  const Lg = L * (1 - s);
  const Ls = L * s;
  const qGood = cesAggregate(
    agent.knowledge,
    Lg,
    cfg.cesAlphaKnowledge,
    cfg.cesRho,
    cfg.cesScale,
  );
  const qServ = cesAggregate(
    agent.knowledge,
    Ls,
    cfg.cesAlphaKnowledge,
    cfg.cesRho,
    cfg.cesScale,
  );
  const q = cfg.cesMixGoods * qGood + (1 - cfg.cesMixGoods) * qServ;
  return { qGood, qServ, q };
}

/**
 * Effective offering quality: weighted CES for goods and services (same K; labor split).
 * Higher knowledge and appropriately allocated labor raise quality.
 */
export function offeringQuality(agent: {
  type: AgentType;
  knowledge: number;
  labor: number;
}, cfg: SimConfig): number {
  return offeringQualityBranches(agent, cfg).q;
}
