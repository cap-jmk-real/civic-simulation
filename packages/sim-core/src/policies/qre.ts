import type { Action, AgentState, WorldState } from "../types.js";
import { ACTIONS } from "../types.js";
import { buildObservation } from "../observe.js";
import { mulberry32 } from "../rng.js";

/** Controls softness of action choice and RNG stream for {@link qrePolicy}. */
export interface QreOptions {
  /** Higher → closer to uniform; lower → closer to argmax of scores. */
  temperature: number;
  /** Mixed into the per-agent RNG seed with agent id length and tick. */
  seedSalt: number;
}

/**
 * Sample an {@link Action} from a softmax over linear scores on observation features (quantal response equilibrium–style).
 */
export function qrePolicy(
  agent: AgentState,
  world: WorldState,
  opts: QreOptions,
): Action {
  const o = buildObservation(agent, world);
  const rnd = mulberry32(opts.seedSalt + agent.id.length * 131 + world.tick * 104729);

  const scores = ACTIONS.map((act) => scoreFeatures(act, o, agent.type));
  const temp = Math.max(0.05, opts.temperature);
  const maxS = Math.max(...scores);
  const exp = scores.map((s) => Math.exp((s - maxS) / temp));
  const sum = exp.reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (let i = 0; i < ACTIONS.length; i++) {
    r -= exp[i]!;
    if (r <= 0) return ACTIONS[i]!;
  }
  return ACTIONS[ACTIONS.length - 1]!;
}

function scoreFeatures(
  act: Action,
  o: ReturnType<typeof buildObservation>,
  type: AgentState["type"],
): number {
  let u = 0;
  const p = o.policy;
  const rep = o.reputation;
  const oq = o.lastOfferingQuality;
  if (Number.isFinite(oq)) {
    u += 0.05 * Math.tanh(oq - 1);
  }

  if (act === "invest_rnd") {
    u += 1.1 + o.knowledge * 0.02;
    u += 0.06 * rep;
    if (type === "bigco") u += 0.6;
    if (type === "solo" || type === "smb") u += 0.25;
  }
  if (act === "publish_open") {
    u += 0.8 + p.openScienceSubsidy * 1.4 + p.dataSharingMandateStrength * 0.8;
    u += 0.05 * rep;
    if (type === "academic") u += 1.4;
    u += Math.sqrt(o.globalPool) * 0.08;
  }
  if (act === "file_patent") {
    if (p.patentRegime === "none") u -= 2;
    else {
      u += 0.04 * rep;
      u += p.patentRegime === "strong" ? 1.1 : 0.45;
      if (type === "bigco") u += 0.9;
      if (type === "academic") u -= 0.4;
    }
    u -= o.patentCount * 0.15;
  }
  if (act === "collaborate") {
    u += 0.35 * o.neighbors.length + 0.2;
    u += 0.08 * rep;
    if (type === "smb" || type === "solo") u += 0.45;
  }
  if (act === "trade") {
    u += 0.15 * o.neighbors.length + 0.12;
    u += 0.1 * rep;
    u += Math.sqrt(o.wealth) * 0.05;
  }
  if (act === "enforce_ip") {
    u += 0.05 * rep;
    u += p.enforcementIntensity * 1.2 - 0.4;
    if (type === "bigco") u += 0.35;
    if (o.patentCount === 0) u -= 0.8;
  }
  if (act === "idle") {
    u += o.wealth < 20 ? 0.5 : -0.05;
    u += 0.02 * rep;
  }
  if (act === "bribe_regulator") {
    if (!o.regulatory.enabled || !o.regulatory.bribeEnabled) u -= 3;
    else {
      const br = o.regulatory;
      u += br.corruption * 0.4 - br.effectiveStringency * 0.35;
      u += (type === "bigco" || type === "smb" ? 0.55 : 0.1) + Math.sqrt(Math.max(0, o.wealth)) * 0.04;
      u -= br.corruption * (type === "academic" ? 0.5 : 0);
    }
  }
  if (act === "spawn_agent") {
    if (!o.spawn.enabled || !o.spawn.canAffordSpawn || o.spawn.atCap) u -= 2.5;
    else {
      u += 0.55 + 0.04 * Math.sqrt(o.population);
      u += (type === "bigco" || type === "smb" ? 0.45 : 0.15) + 0.03 * o.knowledge;
      if (o.population > 80) u -= 0.35;
    }
  }

  return u;
}
