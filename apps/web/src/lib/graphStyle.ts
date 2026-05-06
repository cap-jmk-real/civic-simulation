import type { AgentState, AgentType, CivicRole } from "@ip-sim/core";

/** Economic actor type — used for fills when civic roles are uniform, else as node outline. */
export const ECONOMIC_FILL: Record<AgentType, string> = {
  bigco: "#60a5fa",
  academic: "#a78bfa",
  smb: "#34d399",
  solo: "#fbbf24",
};

export type CivicVisualKey =
  | "citizen"
  | "politician"
  | "servant_fireable"
  | "servant_tenured";

/** Fills for civic categories (WCAG-friendly on #0a0a0c). */
export const CIVIC_FILL: Record<CivicVisualKey, string> = {
  citizen: "#94a3b8",
  politician: "#fb923c",
  servant_fireable: "#22d3ee",
  servant_tenured: "#c084fc",
};

export function civicVisualKey(
  civicRole: CivicRole,
  publicServantFireable: boolean,
): CivicVisualKey {
  if (civicRole === "politician") return "politician";
  if (civicRole === "public_servant") {
    return publicServantFireable ? "servant_fireable" : "servant_tenured";
  }
  return "citizen";
}

/** True when any agent holds a non-default civic office (graph uses civic-first coloring). */
export function civicPrimaryPalette(agents: AgentState[]): boolean {
  return agents.some(
    (a) => a.civicRole === "politician" || a.civicRole === "public_servant",
  );
}

export function nodeFillAndStroke(
  a: AgentState,
  civicPrimary: boolean,
): { fill: string; stroke: string; strokeWidth: number } {
  if (civicPrimary) {
    return {
      fill: CIVIC_FILL[civicVisualKey(a.civicRole, a.publicServantFireable)],
      stroke: ECONOMIC_FILL[a.type],
      strokeWidth: 1.5,
    };
  }
  return {
    fill: ECONOMIC_FILL[a.type],
    stroke: "rgba(15,15,18,0.85)",
    strokeWidth: 1,
  };
}
