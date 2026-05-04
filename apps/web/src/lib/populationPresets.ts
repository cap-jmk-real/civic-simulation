import type { SimConfig } from "@ip-sim/core";

export type PopulationPresetId = "small" | "medium" | "large" | "xlarge";

export const POPULATION_PRESETS: Record<
  PopulationPresetId,
  { label: string; agentCounts: SimConfig["agentCounts"]; ticks: number; baseMarketSize: number }
> = {
  small: {
    label: "Small (~24)",
    agentCounts: { bigco: 3, academic: 6, smb: 8, solo: 7 },
    ticks: 120,
    baseMarketSize: 220,
  },
  medium: {
    label: "Medium (~120)",
    agentCounts: { bigco: 15, academic: 30, smb: 40, solo: 35 },
    ticks: 150,
    baseMarketSize: 900,
  },
  large: {
    label: "Large (~400)",
    agentCounts: { bigco: 50, academic: 100, smb: 125, solo: 125 },
    ticks: 180,
    baseMarketSize: 2800,
  },
  xlarge: {
    label: "Stress (~800)",
    agentCounts: { bigco: 100, academic: 200, smb: 250, solo: 250 },
    ticks: 200,
    baseMarketSize: 5200,
  },
};

export function applyPopulationPreset(
  base: SimConfig,
  id: PopulationPresetId,
): SimConfig {
  const p = POPULATION_PRESETS[id];
  return {
    ...base,
    agentCounts: { ...p.agentCounts },
    ticks: p.ticks,
    baseMarketSize: p.baseMarketSize,
  };
}

export function totalAgents(counts: SimConfig["agentCounts"]): number {
  return (
    counts.bigco + counts.academic + counts.smb + counts.solo
  );
}
