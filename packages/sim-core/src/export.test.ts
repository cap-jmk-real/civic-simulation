import { describe, expect, it } from "vitest";
import { mergeSimConfig } from "./defaultConfig.js";
import { parseRun, serializeRun } from "./export.js";
import type { SimulationRun } from "./types.js";

describe("serializeRun / parseRun", () => {
  it("round-trips a minimal run", () => {
    const run: SimulationRun = {
      manifest: {
        schemaVersion: 1,
        seed: 42,
        policyMode: "heuristic",
        config: mergeSimConfig({ ticks: 3 }),
      },
      history: [],
    };
    const json = serializeRun(run);
    const back = parseRun(json);
    expect(back.manifest.seed).toBe(42);
    expect(back.manifest.config.ticks).toBe(3);
    expect(back.history).toEqual([]);
  });
});
