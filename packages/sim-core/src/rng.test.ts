import { describe, expect, it } from "vitest";
import { mulberry32, shuffleInPlace } from "./rng.js";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it("returns values in [0, 1)", () => {
    const rnd = mulberry32(999);
    for (let i = 0; i < 500; i++) {
      const x = rnd();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("differs across seeds", () => {
    const x = mulberry32(1)();
    const y = mulberry32(2)();
    expect(x).not.toBe(y);
  });
});

describe("shuffleInPlace", () => {
  it("preserves multiset of elements", () => {
    const rnd = mulberry32(42);
    const orig = [1, 2, 3, 4, 5, 6];
    const arr = [...orig];
    shuffleInPlace(arr, rnd);
    expect([...arr].sort((a, b) => a - b)).toEqual([...orig].sort((a, b) => a - b));
  });

  it("produces a permutation (length preserved)", () => {
    const rnd = mulberry32(7);
    const arr: string[] = ["a", "b", "c"];
    shuffleInPlace(arr, rnd);
    expect(arr.length).toBe(3);
    expect(new Set(arr).size).toBe(3);
  });
});
