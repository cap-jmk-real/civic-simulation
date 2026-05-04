import type { AgentState, SimConfig, WorldState } from "./types.js";

/** True when the calendar tick `nextWorldTick` should run the full civic maintenance pass. */
export function isGovernanceMaintenanceTick(
  cfg: SimConfig["governance"],
  nextWorldTick: number,
): boolean {
  if (!cfg.enabled) return false;
  const p = Math.max(1, Math.floor(cfg.electionPeriodTicks));
  return nextWorldTick > 0 && nextWorldTick % p === 0;
}

/**
 * Deterministic initial assignment: stable sort by id, then fill politician seats, fireable servants,
 * tenured servants, remainder citizens. Caps each band to population so initialization never fails.
 */
export function initializeCivicRoles(world: WorldState): void {
  const g = world.config.governance;
  const sorted = [...world.agents].sort((a, b) => a.id.localeCompare(b.id));
  if (!g.enabled) {
    for (const a of sorted) {
      a.civicRole = "citizen";
      a.publicServantFireable = true;
    }
    return;
  }
  const n = sorted.length;
  const seats = Math.min(Math.max(0, Math.floor(g.politicianSeats)), n);
  const fWant = Math.max(0, Math.floor(g.fireableServantTarget));
  const tWant = Math.max(0, Math.floor(g.tenuredServantTarget));
  let idx = 0;
  for (; idx < seats; idx++) {
    sorted[idx].civicRole = "politician";
    sorted[idx].publicServantFireable = true;
  }
  const fCap = Math.min(fWant, Math.max(0, n - idx));
  for (let j = 0; j < fCap; j++, idx++) {
    sorted[idx].civicRole = "public_servant";
    sorted[idx].publicServantFireable = true;
  }
  const tCap = Math.min(tWant, Math.max(0, n - idx));
  for (let j = 0; j < tCap; j++, idx++) {
    sorted[idx].civicRole = "public_servant";
    sorted[idx].publicServantFireable = false;
  }
  for (; idx < n; idx++) {
    sorted[idx].civicRole = "citizen";
    sorted[idx].publicServantFireable = true;
  }
}

function hireScore(a: AgentState, repW: number, kW: number): number {
  return repW * a.reputation + kW * Math.log(1 + Math.max(0, a.knowledge));
}

/**
 * One maintenance cycle (same cadence as elections):
 * 1) Demote incumbent politicians to citizens so every seat is contested on reputation.
 * 2) Fire at-will servants down to target (lowest reputation first) — tenured servants are never fired here.
 * 3) Hire citizens into fireable servant slots up to target using a fixed reputation/knowledge blend.
 * 4) Grant tenure to the strongest eligible fireable servants up to the tenured target.
 * 5) Fill politician seats by election score (reputation + symmetric noise) over candidates who are
 *    citizens or public servants (servants may be elected out of the bureaucracy).
 */
export function applyGovernanceMaintenance(
  world: WorldState,
  cfg: SimConfig,
  rnd: () => number,
): void {
  const g = cfg.governance;
  if (!g.enabled) return;

  const noiseW = Math.max(0, g.electionReputationNoise);
  const repW = Math.max(0, g.hireBlendReputation);
  const kW = Math.max(0, g.hireBlendKnowledge);
  const sumW = repW + kW || 1;

  // 1) Incumbents step down to the citizen pool for this cycle.
  for (const a of world.agents) {
    if (a.civicRole === "politician") {
      a.civicRole = "citizen";
      a.publicServantFireable = true;
    }
  }

  // 2) Fire excess fire-at-will servants (never tenured).
  const fireTarget = Math.max(0, Math.floor(g.fireableServantTarget));
  const fireable = world.agents.filter(
    (a) => a.civicRole === "public_servant" && a.publicServantFireable,
  );
  fireable.sort((a, b) => {
    const dr = a.reputation - b.reputation;
    if (Math.abs(dr) > 1e-9) return dr;
    return a.id.localeCompare(b.id);
  });
  while (fireable.length > fireTarget) {
    const victim = fireable.shift()!;
    victim.civicRole = "citizen";
    victim.publicServantFireable = true;
  }

  // 3) Hire citizens into fireable slots.
  const countFireable = () =>
    world.agents.filter((a) => a.civicRole === "public_servant" && a.publicServantFireable).length;
  while (countFireable() < fireTarget) {
    const citizens = world.agents.filter((a) => a.civicRole === "citizen");
    if (!citizens.length) break;
    citizens.sort((a, b) => {
      const ds = hireScore(b, repW / sumW, kW / sumW) - hireScore(a, repW / sumW, kW / sumW);
      if (Math.abs(ds) > 1e-9) return ds;
      return a.id.localeCompare(b.id);
    });
    const pick = citizens[0]!;
    pick.civicRole = "public_servant";
    pick.publicServantFireable = true;
  }

  // 4) Promote fireable → tenured up to target (bypasses firing while tenured).
  const tenuredTarget = Math.max(0, Math.floor(g.tenuredServantTarget));
  const countTenured = () =>
    world.agents.filter((a) => a.civicRole === "public_servant" && !a.publicServantFireable).length;
  const minRepTenure = g.tenureMinReputation;
  while (countTenured() < tenuredTarget) {
    const pool = world.agents.filter(
      (a) => a.civicRole === "public_servant" && a.publicServantFireable && a.reputation >= minRepTenure,
    );
    if (!pool.length) break;
    pool.sort((a, b) => {
      const dr = b.reputation - a.reputation;
      if (Math.abs(dr) > 1e-9) return dr;
      return a.id.localeCompare(b.id);
    });
    const best = pool[0]!;
    best.publicServantFireable = false;
  }

  // 5) Election among citizens and servants (any non-politician already demoted).
  const seats = Math.max(0, Math.floor(g.politicianSeats));
  const candidates = world.agents.filter(
    (a) => a.civicRole === "citizen" || a.civicRole === "public_servant",
  );
  const scored = candidates.map((a) => ({
    a,
    s: a.reputation + (noiseW > 0 ? (rnd() * 2 - 1) * noiseW : 0),
  }));
  scored.sort((x, y) => {
    const ds = y.s - x.s;
    if (Math.abs(ds) > 1e-9) return ds;
    return x.a.id.localeCompare(y.a.id);
  });
  const winners = new Set(scored.slice(0, Math.min(seats, scored.length)).map((x) => x.a.id));
  for (const a of world.agents) {
    if (winners.has(a.id)) {
      a.civicRole = "politician";
      a.publicServantFireable = true;
    }
  }
}
