import { describe, expect, it } from "vitest";
import type { SimJobSummaryDto } from "./parseJobsResponse";
import type { LabSessionQueueSummary } from "./labSessionsQueueUi";
import { deriveWorkerHealthState, formatAgeShort } from "./workerHealth";

function queuedJob(createdAt: string): SimJobSummaryDto {
  return {
    id: "job-1",
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    policyMode: "heuristic",
    progress_note: null,
    status_note: null,
    error_text: null,
    hasResult: false,
  };
}

describe("deriveWorkerHealthState", () => {
  it("does not warn without queued jobs", () => {
    const state = deriveWorkerHealthState([], [], { nowMs: 1_000_000 });
    expect(state.workerLikelyDown).toBe(false);
    expect(state.queuedJobs).toBe(0);
    expect(state.oldestQueuedAgeMs).toBeNull();
  });

  it("does not warn during startup grace period", () => {
    const state = deriveWorkerHealthState([queuedJob(new Date(995_000).toISOString())], [], {
      nowMs: 1_000_000,
      startupGraceMs: 10_000,
    });
    expect(state.workerLikelyDown).toBe(false);
    expect(state.queuedJobs).toBe(1);
  });

  it("warns when queued jobs age past grace and nothing is running", () => {
    const state = deriveWorkerHealthState([queuedJob(new Date(900_000).toISOString())], [], {
      nowMs: 1_000_000,
      startupGraceMs: 20_000,
    });
    expect(state.workerLikelyDown).toBe(true);
    expect(state.queuedJobs).toBe(1);
    expect(state.oldestQueuedAgeMs).toBe(100_000);
  });

  it("does not warn when a run is active", () => {
    const running: SimJobSummaryDto = { ...queuedJob(new Date(900_000).toISOString()), status: "running" };
    const sessions: LabSessionQueueSummary[] = [];
    const state = deriveWorkerHealthState([queuedJob(new Date(900_000).toISOString()), running], sessions, {
      nowMs: 1_000_000,
      startupGraceMs: 20_000,
    });
    expect(state.workerLikelyDown).toBe(false);
  });
});

describe("formatAgeShort", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatAgeShort(8_000)).toBe("8s");
    expect(formatAgeShort(130_000)).toBe("2m");
    expect(formatAgeShort(7_500_000)).toBe("2h");
  });
});
