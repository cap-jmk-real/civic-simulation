import { describe, expect, it } from "vitest";
import type { LabTrialRow } from "./labSessionsStore";
import { toOptimizationTrialSummary } from "./optimizationTrialSummary";

function sampleTrial(overrides?: Partial<LabTrialRow>): LabTrialRow {
  return {
    id: "trial-1",
    session_id: "session-1",
    generation: 2,
    evaluation_index: 9,
    assignments_json: '[{"id":"x","value":1}]',
    metric_value: 0.42,
    mse: 0.18,
    elapsed_ms: 1250,
    is_new_best: 1,
    run_summary_json: '{"summaryOnly":true}',
    spillover_path: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toOptimizationTrialSummary", () => {
  it("returns lightweight list fields and omits raw payload blobs", () => {
    const summary = toOptimizationTrialSummary(sampleTrial());
    expect(summary).toMatchObject({
      id: "trial-1",
      generation: 2,
      evaluation_index: 9,
      metric_value: 0.42,
      mse: 0.18,
      elapsed_ms: 1250,
      is_new_best: 1,
      has_run_payload: false,
    });
    expect("run_summary_json" in summary).toBe(false);
    expect("spillover_path" in summary).toBe(false);
    expect("assignments_json" in summary).toBe(false);
  });

  it("marks payload availability without resolving full run", () => {
    const summary = toOptimizationTrialSummary(sampleTrial({ spillover_path: "lab-exports/s1/eval-9-full.json" }));
    expect(summary.has_run_payload).toBe(true);
  });
});
