import { describe, expect, it } from "vitest";
import { buildOptimizationLogEvent, formatLabEvalEventType, formatWorkerMetricValue } from "./optimizationLogging";

describe("buildOptimizationLogEvent", () => {
  it("includes event and session id with extra fields", () => {
    const payload = buildOptimizationLogEvent(
      "opt_session_evaluation_begin",
      { sessionId: "sess-123" },
      { generation: 2, evaluationNumber: 5 },
    );

    expect(payload).toEqual({
      event: "opt_session_evaluation_begin",
      sessionId: "sess-123",
      generation: 2,
      evaluationNumber: 5,
    });
  });
});

describe("formatLabEvalEventType", () => {
  it("maps known event types", () => {
    expect(formatLabEvalEventType("opt_eval_begin")).toEqual({ short: "eval+", long: "Evaluation started" });
    expect(formatLabEvalEventType("opt_trial_persisted")).toEqual({ short: "trial", long: "Trial persisted" });
  });

  it("maps legacy/alias worker event names", () => {
    expect(formatLabEvalEventType("opt_session_evaluation_begin")).toEqual({
      short: "eval+",
      long: "Evaluation started",
    });
    expect(formatLabEvalEventType("opt_session_evaluation_end")).toEqual({
      short: "eval-",
      long: "Evaluation finished",
    });
    expect(formatLabEvalEventType("opt_session_trial_persisted")).toEqual({
      short: "trial",
      long: "Trial persisted",
    });
  });

  it("falls back for unknown types", () => {
    expect(formatLabEvalEventType("something_else")).toEqual({ short: "?", long: "Unknown" });
    expect(formatLabEvalEventType(null)).toEqual({ short: "?", long: "Unknown" });
  });
});

describe("formatWorkerMetricValue", () => {
  it("handles null and non-finite", () => {
    expect(formatWorkerMetricValue(null)).toBe("—");
    expect(formatWorkerMetricValue(Number.NaN)).toBe("—");
  });

  it("formats across magnitudes", () => {
    expect(formatWorkerMetricValue(0.012345)).toBe("0.012345");
    expect(formatWorkerMetricValue(1.23456)).toBe("1.235");
    expect(formatWorkerMetricValue(12.3456)).toBe("12.35");
    expect(formatWorkerMetricValue(1234.56)).toBe("1235");
  });
});

