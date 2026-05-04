import { describe, expect, it } from "vitest";
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";
import {
  advanceRegulatoryStringency,
  clamp01,
  computeNetExternalityLoad,
  effectiveStringencyFromState,
  mitigationBaselineStringency,
} from "./regulatory.js";
import type { AgentState, WorldState } from "./types.js";

function solo(k: number, labor: number): AgentState {
  return {
    id: "x",
    type: "solo",
    civicRole: "citizen",
    publicServantFireable: true,
    wealth: 50,
    knowledge: k,
    labor,
    patentExpiresAt: [],
    reputation: 1,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    lastOfferingQuality: 1,
  };
}

function worldStub(reg: WorldState["regulatory"], cfg: ReturnType<typeof mergeSimConfig>): WorldState {
  return {
    tick: 0,
    agents: [],
    edges: [],
    globalPool: 0,
    marketSize: 100,
    config: cfg,
    regulatory: reg,
    lastRegulatoryTick: null,
  };
}

describe("clamp01", () => {
  it("clamps below 0 and above 1", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });
});

describe("effectiveStringencyFromState", () => {
  it("reduces stringency when corruption and erosion are positive", () => {
    expect(effectiveStringencyFromState(1, 0, 0.5)).toBe(1);
    expect(effectiveStringencyFromState(1, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("computeNetExternalityLoad", () => {
  it("sums signed goods and services channel loads", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({
      cesQualityEnabled: true,
      regulatory: {
        ...d.regulatory,
        goodsExternalityByProducer: {
          ...d.regulatory.goodsExternalityByProducer,
          solo: 2,
        },
        servicesExternalityByProducer: {
          ...d.regulatory.servicesExternalityByProducer,
          solo: -1,
        },
      },
    });
    const agents = [solo(10, 5)];
    const { goodsChannel, servicesChannel, netLoad } = computeNetExternalityLoad(agents, cfg);
    expect(goodsChannel).toBeGreaterThan(0);
    expect(servicesChannel).toBeLessThan(0);
    expect(netLoad).toBe(goodsChannel + servicesChannel);
  });
});

describe("mitigationBaselineStringency", () => {
  it("fixed mode ignores stored stringency and uses ambition scale", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({
      regulatory: {
        ...d.regulatory,
        enabled: true,
        ruleMode: "fixed",
        baseStringency: 1,
        policyScale: 1,
      },
      policy: { ...d.policy, regulatoryAmbition: 0 },
    });
    const w = worldStub({ stringency: 0.99, corruption: 0 }, cfg);
    expect(mitigationBaselineStringency(w, cfg)).toBeCloseTo(0.2, 6);
  });

  it("dynamic mode uses stored stringency with erosion", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({
      regulatory: {
        ...d.regulatory,
        enabled: true,
        ruleMode: "dynamic",
        baseStringency: 0.5,
        bribe: { ...d.regulatory.bribe, corruptionErodesStringency: 1 },
      },
    });
    const w = worldStub({ stringency: 0.8, corruption: 0.5 }, cfg);
    const eff = mitigationBaselineStringency(w, cfg);
    expect(eff).toBeCloseTo(0.4, 6);
  });
});

describe("advanceRegulatoryStringency", () => {
  it("no-op when regulation disabled", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({ regulatory: { ...d.regulatory, enabled: false } });
    const w = worldStub({ stringency: 0.5, corruption: 0.2 }, cfg);
    advanceRegulatoryStringency(w, cfg, () => 0.5);
    expect(w.regulatory.stringency).toBe(0.5);
  });

  it("fixed mode sets stringency from ambition each tick", () => {
    const d = defaultSimConfig();
    const cfg = mergeSimConfig({
      regulatory: {
        ...d.regulatory,
        enabled: true,
        ruleMode: "fixed",
        baseStringency: 1,
        policyScale: 1,
      },
      policy: { ...d.policy, regulatoryAmbition: 1 },
    });
    const w = worldStub({ stringency: 0.1, corruption: 0 }, cfg);
    advanceRegulatoryStringency(w, cfg, () => 0);
    expect(w.regulatory.stringency).toBeCloseTo(1, 6);
  });
});
