import { describe, expect, it } from "vitest";
import { formatSimJobDebugPayload } from "./jobDebugPayload";
import type { SimJobDetailDto, SimJobSummaryDto } from "./parseJobsResponse";

function summary(overrides?: Partial<SimJobSummaryDto>): SimJobSummaryDto {
  return {
    id: "job-123",
    status: "running",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:02.000Z",
    policyMode: "heuristic",
    progress_note: "tick 10/100",
    status_note: null,
    error_text: null,
    hasResult: false,
    ...overrides,
  };
}

function detail(overrides?: Partial<SimJobDetailDto>): SimJobDetailDto {
  return {
    id: "job-123",
    status: "failed",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:05.000Z",
    heartbeat_at: "2026-01-01T00:00:05.000Z",
    progress_note: "tick 33/100",
    status_note: "solver diverged",
    error_text: "solver diverged",
    result_json: JSON.stringify({ final: true }),
    result_meta: {
      storedPath: "sim-results/job-123.json",
      outputBytes: 2222,
      elapsedMs: 5000,
    },
    payload: {
      policyMode: "qre",
      qreTemp: 0.7,
      config: {
        n: 64,
        ticks: 150,
        randomSeed: 987,
        apiKey: "secret-do-not-copy",
      },
      sessionId: "sess-1",
      labSessionId: "lab-sess-7",
      projectId: "proj-9",
    },
    ...overrides,
  };
}

describe("formatSimJobDebugPayload", () => {
  it("formats compact plain text with summary + json block", () => {
    const out = formatSimJobDebugPayload({ summary: summary(), detail: detail() });
    expect(out).toContain("Simulation queue debug payload");
    expect(out).toContain("job.id: job-123");
    expect(out).toContain("request.policy_mode: qre");
    expect(out).toContain("request.n: 64");
    expect(out).toContain("request.ticks: 150");
    expect(out).toContain("request.random_seed: 987");
    expect(out).toContain("result.elapsed_ms: 5000");
    expect(out).toContain("result.output_bytes: 2222");
    expect(out).toContain("result.stored_path: sim-results/job-123.json");
    expect(out).toContain("related.project_id: proj-9");
    expect(out).toContain("\njson:\n{");
  });

  it("never includes likely secret fields", () => {
    const out = formatSimJobDebugPayload({ summary: summary(), detail: detail() });
    expect(out).not.toContain("secret-do-not-copy");
    expect(out).not.toContain("apiKey");
  });

  it("falls back to summary-only values when detail missing", () => {
    const out = formatSimJobDebugPayload({ summary: summary({ status: "queued" }), detail: null });
    expect(out).toContain("job.status: queued");
    expect(out).toContain("request.n: n/a");
    expect(out).toContain("result.output_bytes: n/a");
    expect(out).toContain("related.session_id: n/a");
  });
});
