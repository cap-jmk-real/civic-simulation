import { describe, expect, it } from "vitest";
import type { LabBatchCellRow } from "./labSessionsStore";
import { toLabBatchCellSummary } from "./labBatchCellSummary";

function sampleCell(overrides?: Partial<LabBatchCellRow>): LabBatchCellRow {
  return {
    id: "cell-1",
    session_id: "session-1",
    cell_index: 7,
    cell_client_id: "client-7",
    label: "alpha",
    assignments_json: '[{"id":"x","value":1}]',
    run_summary_json: '{"summaryOnly":true}',
    spillover_path: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toLabBatchCellSummary", () => {
  it("returns lightweight list fields and excludes heavy payload blobs", () => {
    const summary = toLabBatchCellSummary(sampleCell());
    expect(summary).toMatchObject({
      id: "cell-1",
      session_id: "session-1",
      cell_index: 7,
      cell_client_id: "client-7",
      label: "alpha",
      has_run_payload: false,
    });
    expect("assignments_json" in summary).toBe(false);
    expect("run_summary_json" in summary).toBe(false);
    expect("spillover_path" in summary).toBe(false);
  });

  it("marks payload availability without loading full run", () => {
    const summary = toLabBatchCellSummary(sampleCell({ spillover_path: "lab-exports/s1/cell-7-full.json" }));
    expect(summary.has_run_payload).toBe(true);
  });
});
