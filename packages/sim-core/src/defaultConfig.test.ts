import { describe, expect, it } from "vitest";
import { defaultSimConfig, mergeSimConfig } from "./defaultConfig.js";

describe("mergeSimConfig", () => {
  it("deep-merges policy and regulatory nested objects", () => {
    const d = defaultSimConfig();
    const m = mergeSimConfig({
      policy: { ...d.policy, openScienceSubsidy: 0.99 },
      regulatory: {
        ...d.regulatory,
        enabled: true,
        bribe: { ...d.regulatory.bribe, baseCost: 123 },
        goodsExternalityByProducer: {
          ...d.regulatory.goodsExternalityByProducer,
          solo: 0.5,
        },
      },
    });
    expect(m.policy.patentRegime).toBe(d.policy.patentRegime);
    expect(m.policy.openScienceSubsidy).toBe(0.99);
    expect(m.policy.regulatoryAmbition).toBe(d.policy.regulatoryAmbition);
    expect(m.regulatory.enabled).toBe(true);
    expect(m.regulatory.bribe.baseCost).toBe(123);
    expect(m.regulatory.bribe.detectionProbability).toBe(d.regulatory.bribe.detectionProbability);
    expect(m.regulatory.goodsExternalityByProducer.solo).toBe(0.5);
    expect(m.regulatory.goodsExternalityByProducer.bigco).toBe(
      d.regulatory.goodsExternalityByProducer.bigco,
    );
  });

  it("deep-merges governance", () => {
    const d = defaultSimConfig();
    const m = mergeSimConfig({
      governance: { ...d.governance, enabled: true, politicianSeats: 5 },
    });
    expect(m.governance.enabled).toBe(true);
    expect(m.governance.politicianSeats).toBe(5);
    expect(m.governance.electionPeriodTicks).toBe(d.governance.electionPeriodTicks);
  });
});
