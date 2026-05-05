import { describe, expect, it } from "vitest";
import { capHydrationCandidates, shouldSkipSimResultHydration } from "./hydrationThrottle";

describe("shouldSkipSimResultHydration", () => {
  it("skips while a lab runner is active", () => {
    expect(
      shouldSkipSimResultHydration({
        runnerActive: true,
        inFlight: false,
        candidateCount: 3,
      }),
    ).toBe(true);
  });

  it("skips when a cycle is already in flight", () => {
    expect(
      shouldSkipSimResultHydration({
        runnerActive: false,
        inFlight: true,
        candidateCount: 3,
      }),
    ).toBe(true);
  });

  it("skips when there are no candidates", () => {
    expect(
      shouldSkipSimResultHydration({
        runnerActive: false,
        inFlight: false,
        candidateCount: 0,
      }),
    ).toBe(true);
  });

  it("allows hydration only when safe", () => {
    expect(
      shouldSkipSimResultHydration({
        runnerActive: false,
        inFlight: false,
        candidateCount: 2,
      }),
    ).toBe(false);
  });
});

describe("capHydrationCandidates", () => {
  it("caps list length to limit", () => {
    expect(capHydrationCandidates([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });

  it("returns empty for invalid limits", () => {
    expect(capHydrationCandidates([1, 2], 0)).toEqual([]);
    expect(capHydrationCandidates([1, 2], Number.NaN)).toEqual([]);
  });
});
