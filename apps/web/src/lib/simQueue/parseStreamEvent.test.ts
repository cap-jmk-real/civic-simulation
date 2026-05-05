import { describe, expect, it } from "vitest";
import { formatSseDataLine, parseQueueLabStreamPayload } from "./parseStreamEvent";

describe("parseQueueLabStreamPayload", () => {
  it("accepts a valid snapshot", () => {
    const raw = JSON.stringify({
      jobs: [
        {
          id: "j1",
          status: "running",
          created_at: "t0",
          updated_at: "t1",
          policyMode: "qre",
          progress_note: "tick 1/10",
          error_text: null,
          hasResult: false,
        },
      ],
      sessions: [
        {
          id: "s1",
          sessionType: "grid_batch",
          status: "running",
          updatedAt: "t2",
          heartbeatAt: "t2",
          statusNote: null,
          trialCount: 0,
          cellCount: 3,
          projectId: null,
        },
      ],
    });
    const r = parseQueueLabStreamPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.jobs).toHaveLength(1);
      expect(r.data.jobs[0]!.id).toBe("j1");
      expect(r.data.sessions).toHaveLength(1);
      expect(r.data.sessions[0]!.cellCount).toBe(3);
    }
  });

  it("rejects invalid JSON", () => {
    expect(parseQueueLabStreamPayload("not json").ok).toBe(false);
  });

  it("rejects bad session row", () => {
    const raw = JSON.stringify({
      jobs: [],
      sessions: [{ id: "x" }],
    });
    expect(parseQueueLabStreamPayload(raw).ok).toBe(false);
  });
});

describe("formatSseDataLine", () => {
  it("prefixes data and ends with double newline", () => {
    expect(formatSseDataLine({ a: 1 })).toBe('data: {"a":1}\n\n');
  });
});
