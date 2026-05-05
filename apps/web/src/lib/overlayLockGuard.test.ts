import { describe, expect, it } from "vitest";
import {
  isLabInteractionActive,
  shouldClearStaleOverlay,
  type LabInteractionActivity,
} from "@/lib/overlayLockGuard";

function activity(overrides: Partial<LabInteractionActivity> = {}): LabInteractionActivity {
  return {
    running: false,
    enqueueBusy: false,
    gridRunnerActive: false,
    optimizationRunnerActive: false,
    ...overrides,
  };
}

describe("overlayLockGuard", () => {
  it("reports active while any run-related flag is true", () => {
    expect(isLabInteractionActive(activity())).toBe(false);
    expect(isLabInteractionActive(activity({ running: true }))).toBe(true);
    expect(isLabInteractionActive(activity({ enqueueBusy: true }))).toBe(true);
    expect(isLabInteractionActive(activity({ gridRunnerActive: true }))).toBe(true);
    expect(isLabInteractionActive(activity({ optimizationRunnerActive: true }))).toBe(true);
  });

  it("clears stale overlays only on active-to-idle transition", () => {
    expect(shouldClearStaleOverlay(false, false)).toBe(false);
    expect(shouldClearStaleOverlay(false, true)).toBe(false);
    expect(shouldClearStaleOverlay(true, true)).toBe(false);
    expect(shouldClearStaleOverlay(true, false)).toBe(true);
  });
});
