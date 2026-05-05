import { describe, expect, it } from "vitest";
import { parseSimJobDetailResponse, parseSimJobsListResponse } from "./parseJobsResponse";

describe("parseSimJobsListResponse", () => {
  it("parses jobs and progress_note", () => {
    const { jobs, error } = parseSimJobsListResponse({
      jobs: [
        {
          id: "j1",
          status: "running",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:01.000Z",
          policyMode: "heuristic",
          progress_note: "tick 40/100",
          status_note: null,
          error_text: null,
          hasResult: false,
        },
      ],
    });
    expect(error).toBeUndefined();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.progress_note).toBe("tick 40/100");
    expect(jobs[0]?.status).toBe("running");
  });

  it("surfaces API error string", () => {
    const { jobs, error } = parseSimJobsListResponse({ error: "db locked" });
    expect(error).toBe("db locked");
    expect(jobs).toEqual([]);
  });
});

describe("parseSimJobDetailResponse", () => {
  it("parses detail progress for live polling", () => {
    const { detail, error } = parseSimJobDetailResponse({
      id: "x",
      status: "running",
      created_at: "a",
      updated_at: "b",
      heartbeat_at: "b",
      progress_note: "tick 5/10",
      status_note: "stale heartbeat",
      error_text: null,
      result_json: null,
      payload: { policyMode: "heuristic" },
    });
    expect(error).toBeUndefined();
    expect(detail?.progress_note).toBe("tick 5/10");
    expect(detail?.status_note).toBe("stale heartbeat");
    expect(detail?.payload).toEqual({ policyMode: "heuristic" });
  });
});
