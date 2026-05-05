import { describe, expect, it } from "vitest";
import { resolveOptimizationExecutionMode } from "./optimizationExecutionMode";

describe("resolveOptimizationExecutionMode", () => {
  it("selects worker mode by default when workers are supported", () => {
    expect(resolveOptimizationExecutionMode("non-blocking", true)).toEqual({
      mode: "worker",
      fallback: false,
    });
  });

  it("falls back to main thread when workers are unavailable", () => {
    expect(resolveOptimizationExecutionMode("non-blocking", false)).toEqual({
      mode: "main-thread",
      fallback: true,
    });
  });

  it("honors explicit main-thread preference", () => {
    expect(resolveOptimizationExecutionMode("main-thread", true)).toEqual({
      mode: "main-thread",
      fallback: false,
    });
  });
});
