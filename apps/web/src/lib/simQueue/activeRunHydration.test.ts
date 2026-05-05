import { describe, expect, it } from "vitest";
import { deriveActiveRunHydrationState, type LabSessionHydrationSummary } from "./activeRunHydration";
import type { SimJobSummaryDto } from "./parseJobsResponse";

function makeJob(overrides: Partial<SimJobSummaryDto>): SimJobSummaryDto {
  return {
    id: "job-1",
    status: "queued",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    policyMode: "qre",
    progress_note: null,
    status_note: null,
    error_text: null,
    hasResult: false,
    ...overrides,
  };
}

function makeSession(overrides: Partial<LabSessionHydrationSummary>): LabSessionHydrationSummary {
  return {
    id: "session-1",
    sessionType: "grid_batch",
    status: "running",
    updatedAt: "2026-01-01T00:00:00.000Z",
    trialCount: 0,
    cellCount: 0,
    ...overrides,
  };
}

describe("deriveActiveRunHydrationState", () => {
  it("prefers a running single job over queued", () => {
    const state = deriveActiveRunHydrationState({
      jobs: [
        makeJob({ id: "queued-newer", status: "queued", updated_at: "2026-01-02T00:00:00.000Z" }),
        makeJob({ id: "running-older", status: "running", updated_at: "2026-01-01T00:00:00.000Z" }),
      ],
      sessions: [],
    });
    expect(state.singleJob?.id).toBe("running-older");
  });

  it("uses newest running lab session per tab type", () => {
    const state = deriveActiveRunHydrationState({
      jobs: [],
      sessions: [
        makeSession({
          id: "grid-old",
          sessionType: "grid_batch",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        makeSession({
          id: "grid-new",
          sessionType: "grid_batch",
          updatedAt: "2026-01-03T00:00:00.000Z",
        }),
        makeSession({
          id: "opt-running",
          sessionType: "optimization",
          updatedAt: "2026-01-02T00:00:00.000Z",
          trialCount: 22,
        }),
      ],
    });
    expect(state.gridSession?.id).toBe("grid-new");
    expect(state.optimizationSession?.id).toBe("opt-running");
  });

  it("falls back to newest queued session when no running session exists", () => {
    const state = deriveActiveRunHydrationState({
      jobs: [],
      sessions: [
        makeSession({
          id: "opt-queued-old",
          sessionType: "optimization",
          status: "queued",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        makeSession({
          id: "opt-queued-new",
          sessionType: "optimization",
          status: "queued",
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
      ],
    });
    expect(state.optimizationSession?.id).toBe("opt-queued-new");
  });

  it("ignores non-running lab sessions", () => {
    const state = deriveActiveRunHydrationState({
      jobs: [],
      sessions: [
        makeSession({
          id: "grid-complete",
          sessionType: "grid_batch",
          status: "complete",
        }),
      ],
    });
    expect(state.gridSession).toBeNull();
    expect(state.optimizationSession).toBeNull();
  });

  it("clears active pointers after abrupt terminal transitions", () => {
    const state = deriveActiveRunHydrationState({
      jobs: [
        makeJob({ id: "done-job", status: "done", updated_at: "2026-01-03T00:00:00.000Z" }),
        makeJob({ id: "failed-job", status: "failed", updated_at: "2026-01-03T00:00:01.000Z" }),
        makeJob({ id: "cancelled-job", status: "cancelled", updated_at: "2026-01-03T00:00:02.000Z" }),
      ],
      sessions: [
        makeSession({
          id: "opt-cancelled",
          sessionType: "optimization",
          status: "cancelled",
          updatedAt: "2026-01-03T00:00:03.000Z",
        }),
        makeSession({
          id: "grid-complete",
          sessionType: "grid_batch",
          status: "complete",
          updatedAt: "2026-01-03T00:00:04.000Z",
        }),
      ],
    });
    expect(state.singleJob).toBeNull();
    expect(state.gridSession).toBeNull();
    expect(state.optimizationSession).toBeNull();
  });
});
