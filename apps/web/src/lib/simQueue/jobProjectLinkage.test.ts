import { describe, expect, it } from "vitest";
import type { AnalysisBatch } from "@/lib/analysisTypes";
import {
  attachSimJobResultToBatch,
  canHydrateSimJobBatchResult,
  isSerializedRunJson,
  simJobDetailPath,
  shouldFetchSimJobDetailOnSelection,
} from "./jobProjectLinkage";

function sampleBatch(overrides?: Partial<AnalysisBatch>): AnalysisBatch {
  return {
    id: "job_123",
    name: "Queued run",
    createdAt: "2026-01-01T00:00:00.000Z",
    constructionMode: "pending",
    levelProductLabel: "pending",
    cells: [],
    kind: "single",
    status: "done",
    runRef: { kind: "sim_job", id: "job_123" },
    folderId: null,
    fullRunJson: undefined,
    ...overrides,
  };
}

describe("sim job project linkage", () => {
  it("detects batches eligible for hydration", () => {
    expect(canHydrateSimJobBatchResult(sampleBatch())).toBe(true);
    expect(canHydrateSimJobBatchResult(sampleBatch({ status: "running" }))).toBe(false);
    expect(canHydrateSimJobBatchResult(sampleBatch({ runRef: { kind: "lab_session", id: "s1" } }))).toBe(false);
    expect(canHydrateSimJobBatchResult(sampleBatch({ fullRunJson: "{}" }))).toBe(false);
  });

  it("accepts serialized run json shape", () => {
    expect(isSerializedRunJson(JSON.stringify({ manifest: { seed: 1 }, history: [] }))).toBe(true);
    expect(isSerializedRunJson(JSON.stringify({ _storedPath: "sim-results/a.json" }))).toBe(false);
    expect(isSerializedRunJson("not-json")).toBe(false);
  });

  it("hydrates fullRunJson for done sim-job batches", () => {
    const src = sampleBatch();
    const runJson = JSON.stringify({ manifest: { seed: 7 }, history: [{ metrics: { tick: 1 } }] });
    const hydrated = attachSimJobResultToBatch(src, runJson);
    expect(hydrated).not.toBeNull();
    expect(hydrated?.fullRunJson).toBe(runJson);
    expect(hydrated?.status).toBe("done");
  });

  it("marks non-run result payloads as skipped once", () => {
    const src = sampleBatch();
    const pointerJson = JSON.stringify({ _storedPath: "sim-results/job_123.json", _bytes: 5_000_000 });
    const first = attachSimJobResultToBatch(src, pointerJson);
    expect(first).not.toBeNull();
    expect(first?.simJobHydration).toBe("skipped");
    expect(canHydrateSimJobBatchResult(first as AnalysisBatch)).toBe(false);

    const second = attachSimJobResultToBatch(first as AnalysisBatch, pointerJson);
    expect(second).toBeNull();
  });

  it("builds encoded detail path for selected sim jobs", () => {
    expect(simJobDetailPath("job-1")).toBe("/api/sim/jobs/job-1");
    expect(simJobDetailPath("job with/slash")).toBe("/api/sim/jobs/job%20with%2Fslash");
  });

  it("only enables detail fetch for explicit single-run selection candidates", () => {
    expect(shouldFetchSimJobDetailOnSelection(sampleBatch())).toBe(true);
    expect(shouldFetchSimJobDetailOnSelection(sampleBatch({ fullRunJson: "{}" }))).toBe(false);
    expect(shouldFetchSimJobDetailOnSelection(sampleBatch({ status: "running" }))).toBe(false);
  });
});
