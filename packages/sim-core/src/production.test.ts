import { describe, expect, it } from "vitest";
import { cesAggregate, offeringQuality, serviceLaborShare } from "./production.js";
import { mergeSimConfig } from "./defaultConfig.js";
import type { SimConfig } from "./types.js";

describe("cesAggregate", () => {
  it("approaches Cobb–Douglas as ρ → 0", () => {
    const cd = cesAggregate(10, 10, 0.5, 0, 1);
    expect(cd).toBeCloseTo(10, 6);
  });

  it("is higher when both K and L increase (ρ < 0)", () => {
    const low = cesAggregate(5, 5, 0.5, -0.4, 1);
    const high = cesAggregate(20, 20, 0.5, -0.4, 1);
    expect(high).toBeGreaterThan(low);
  });
});

describe("offeringQuality", () => {
  const base = mergeSimConfig({
    cesQualityEnabled: true,
    cesAlphaKnowledge: 0.55,
    cesRho: -0.35,
    cesScale: 0.2,
    cesMixGoods: 0.5,
  });

  it("rises with knowledge holding labor fixed", () => {
    const cfg = base as SimConfig;
    const lowQ = offeringQuality(
      { type: "smb", knowledge: 5, labor: 8 },
      cfg,
    );
    const highQ = offeringQuality(
      { type: "smb", knowledge: 40, labor: 8 },
      cfg,
    );
    expect(highQ).toBeGreaterThan(lowQ);
  });

  it("returns 1 when CES disabled", () => {
    const cfg = mergeSimConfig({ cesQualityEnabled: false });
    const q = offeringQuality(
      { type: "bigco", knowledge: 100, labor: 20 },
      cfg as SimConfig,
    );
    expect(q).toBe(1);
  });

  it("shifts labor toward services for academics vs bigcos", () => {
    expect(serviceLaborShare("academic")).toBeGreaterThan(serviceLaborShare("bigco"));
  });
});
