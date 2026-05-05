import { describe, expect, it } from "vitest";
import type { LabSessionQueueSummary } from "./labSessionsQueueUi";
import { formatLabSessionDebugPayload } from "./labSessionDebugPayload";

function summary(overrides?: Partial<LabSessionQueueSummary>): LabSessionQueueSummary {
  return {
    id: "lab-123",
    sessionType: "optimization",
    status: "running",
    updatedAt: "2026-01-01T00:00:10.000Z",
    heartbeatAt: "2026-01-01T00:00:10.000Z",
    statusNote: null,
    trialCount: 12,
    cellCount: 0,
    projectId: "proj-7",
    ...overrides,
  };
}

describe("formatLabSessionDebugPayload", () => {
  it("formats compact payload with key fields and json block", () => {
    const out = formatLabSessionDebugPayload({
      summary: summary(),
      detail: {
        id: "lab-123",
        sessionType: "optimization",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:12.000Z",
        projectId: "proj-7",
        bestTrialId: "trial-9",
        trialCount: 13,
        cellCount: 0,
        meta: {
          label: "Optimization",
          policyMode: "qre",
          populationSize: 4,
          generations: 8,
          lastPersistedTrialAt: "2026-01-01T00:00:11.000Z",
          rawPayload: { huge: "omit-me" },
          secretToken: "hide-me",
        },
      },
    });
    expect(out).toContain("Lab session debug payload");
    expect(out).toContain("session.id: lab-123");
    expect(out).toContain("rows.trials: 13");
    expect(out).toContain("rows.planned: 32");
    expect(out).toContain("related.best_trial_id: trial-9");
    expect(out).toContain("progress.last_write_at: 2026-01-01T00:00:11.000Z");
    expect(out).toContain('"policyMode": "qre"');
    expect(out).toContain("\njson:\n{");
  });

  it("omits likely sensitive or large raw meta fields", () => {
    const out = formatLabSessionDebugPayload({
      summary: summary(),
      detail: {
        id: "lab-123",
        sessionType: "optimization",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:12.000Z",
        projectId: "proj-7",
        bestTrialId: null,
        trialCount: 13,
        cellCount: 0,
        meta: {
          secretToken: "hide-me",
          fullRunJson: "{ giant blob }",
          rawPayload: { huge: true },
          label: "Optimization",
        },
      },
    });
    expect(out).toContain('"label": "Optimization"');
    expect(out).not.toContain("hide-me");
    expect(out).not.toContain("secretToken");
    expect(out).not.toContain("rawPayload");
    expect(out).not.toContain("fullRunJson");
  });

  it("falls back to summary values when detail missing", () => {
    const out = formatLabSessionDebugPayload({
      summary: summary({ sessionType: "grid_batch", trialCount: 0, cellCount: 22 }),
      detail: null,
    });
    expect(out).toContain("session.type: grid_batch");
    expect(out).toContain("rows.cells: 22");
    expect(out).toContain("rows.planned: 22");
    expect(out).toContain("related.best_trial_id: n/a");
    expect(out).toContain("progress.last_write_at: n/a");
  });
});
