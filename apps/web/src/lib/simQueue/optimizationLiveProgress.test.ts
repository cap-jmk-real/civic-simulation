import { describe, expect, it } from "vitest";
import type { LabSessionHydrationSummary } from "./activeRunHydration";
import {
  deriveOptimizationTrialRunsCountText,
  deriveOptimizationVisibleTrialRows,
  deriveBestOptimizationOverviewRowId,
  deriveSessionOptimizationSettings,
  deriveOptimizationEvalTimingDisplay,
  deriveOptimizationWaitingDiagnostics,
  deriveOptimizationSessionStartMs,
  deriveHydratedOptimizationOverviewRows,
  deriveHydratedOptimizationLiveProgress,
  deriveHydratedRecentFinishedOptimizationTrials,
  formatOptimizationDurationMs,
  getDefaultOptimizationOverviewSort,
  isOptimizationOverviewRowBest,
  isOptimizationOverviewRowPreviewable,
  shouldRefreshHydratedOverview,
  sortOptimizationOverviewRows,
  type PersistedOptimizationTrial,
} from "./optimizationLiveProgress";

function makeSession(overrides: Partial<LabSessionHydrationSummary>): LabSessionHydrationSummary {
  return {
    id: "session-1",
    sessionType: "optimization",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    trialCount: 0,
    cellCount: 0,
    ...overrides,
  };
}

describe("deriveHydratedOptimizationLiveProgress", () => {
  it("uses latest evaluations from snapshot over session count", () => {
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({
        trialCount: 4,
        meta: { populationSize: 5, generations: 10 },
      }),
      snapshot: { evaluationIndex: 7, generation: 1, trialCount: 7 },
      nowMs: Date.parse("2026-01-01T00:00:10.000Z"),
    });
    expect(live.evaluations).toBe(7);
    expect(live.planned).toBe(50);
    expect(live.generation).toBe(1);
  });

  it("returns null planned count when meta is missing", () => {
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({ trialCount: 3, meta: {} }),
      snapshot: null,
      nowMs: Date.parse("2026-01-01T00:00:05.000Z"),
    });
    expect(live.evaluations).toBe(3);
    expect(live.planned).toBeNull();
    expect(live.generation).toBeNull();
    expect(live.throughputPerSec).not.toBeNull();
  });

  it("uses snapshot generation when available", () => {
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({ trialCount: 6, meta: { populationSize: 4, generations: 5 } }),
      snapshot: { evaluationIndex: 6, generation: 1, trialCount: 6 },
      nowMs: Date.parse("2026-01-01T00:00:12.000Z"),
    });
    expect(live.generation).toBe(1);
  });

  it("uses snapshot trialCount when evaluation index is stale", () => {
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({ trialCount: 0, meta: { populationSize: 12, generations: 15 } }),
      snapshot: { evaluationIndex: 0, generation: 0, trialCount: 9 },
      nowMs: Date.parse("2026-01-01T00:00:15.000Z"),
    });
    expect(live.evaluations).toBe(9);
    expect(live.planned).toBe(180);
  });

  it("anchors elapsedMs to createdAt when available", () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const now = Date.parse("2026-01-01T00:00:20.000Z");
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({ createdAt }),
      snapshot: { evaluationIndex: 5, generation: 0, trialCount: 5 },
      nowMs: now,
    });
    expect(live.elapsedMs).toBe(20_000);
  });

  it("falls back to updatedAt for elapsedMs when createdAt is missing", () => {
    const updatedAt = "2026-01-01T00:00:10.000Z";
    const now = Date.parse("2026-01-01T00:00:40.000Z");
    const live = deriveHydratedOptimizationLiveProgress({
      session: makeSession({ createdAt: undefined, updatedAt }),
      snapshot: { evaluationIndex: 3, generation: 0, trialCount: 3 },
      nowMs: now,
    });
    expect(live.elapsedMs).toBe(30_000);
  });

  it("keeps elapsedMs monotonic when sessionStartMs is supplied", () => {
    const startMs = Date.parse("2026-01-01T00:00:05.000Z");
    const session = makeSession({
      createdAt: undefined,
      updatedAt: "2026-01-01T00:00:50.000Z", // deliberately misleading; should be ignored
      trialCount: 0,
    });
    const a = deriveHydratedOptimizationLiveProgress({
      session,
      snapshot: { evaluationIndex: 0, generation: 0, trialCount: 0 },
      nowMs: startMs + 3_000,
      sessionStartMs: startMs,
    });
    const b = deriveHydratedOptimizationLiveProgress({
      session,
      snapshot: { evaluationIndex: 0, generation: 0, trialCount: 0 },
      nowMs: startMs + 7_000,
      sessionStartMs: startMs,
    });
    expect(a.elapsedMs).toBe(3_000);
    expect(b.elapsedMs).toBe(7_000);
    expect(b.elapsedMs).toBeGreaterThanOrEqual(a.elapsedMs);
  });
});

describe("deriveOptimizationSessionStartMs", () => {
  it("prefers createdAt, then updatedAt, then observedAtMs", () => {
    const observedAtMs = Date.parse("2026-01-01T00:02:00.000Z");
    expect(
      deriveOptimizationSessionStartMs({
        session: makeSession({ createdAt: "2026-01-01T00:00:10.000Z", updatedAt: "2026-01-01T00:01:00.000Z" }),
        observedAtMs,
      }),
    ).toBe(Date.parse("2026-01-01T00:00:10.000Z"));
    expect(
      deriveOptimizationSessionStartMs({
        session: makeSession({ createdAt: undefined, updatedAt: "2026-01-01T00:01:00.000Z" }),
        observedAtMs,
      }),
    ).toBe(Date.parse("2026-01-01T00:01:00.000Z"));
    expect(
      deriveOptimizationSessionStartMs({
        session: makeSession({ createdAt: undefined, updatedAt: "not-a-date" }),
        observedAtMs,
      }),
    ).toBe(observedAtMs);
  });
});

describe("deriveSessionOptimizationSettings", () => {
  it("reads metric/objective/target from valid optimization meta", () => {
    expect(
      deriveSessionOptimizationSettings({
        metric: "meanWealth",
        objective: "target",
        target: 123.45,
        policyMode: "qre",
        qreTemp: 0.55,
      }),
    ).toEqual({
      metric: "meanWealth",
      objective: "target",
      target: 123.45,
      policyMode: "qre",
      qreTemp: 0.55,
    });
  });

  it("drops invalid metric/objective while preserving finite target", () => {
    expect(
      deriveSessionOptimizationSettings({
        metric: "innovation_f",
        objective: "max",
        target: 5,
        policyMode: "llm",
        qreTemp: Number.NaN,
      }),
    ).toEqual({
      metric: null,
      objective: null,
      target: 5,
      policyMode: null,
      qreTemp: null,
    });
  });

  it("returns null settings for non-object meta", () => {
    expect(deriveSessionOptimizationSettings(null)).toEqual({
      metric: null,
      objective: null,
      target: null,
      policyMode: null,
      qreTemp: null,
    });
  });
});

describe("deriveHydratedRecentFinishedOptimizationTrials", () => {
  function trial(
    evaluation: number,
    overrides: Partial<PersistedOptimizationTrial> = {},
  ): PersistedOptimizationTrial {
    return {
      id: `trial-${evaluation}`,
      generation: Math.floor(evaluation / 4),
      evaluation_index: evaluation,
      metric_value: 0.1 * evaluation,
      mse: evaluation / 100,
      elapsed_ms: evaluation * 100,
      created_at: `2026-01-01T00:00:${String(Math.min(59, evaluation)).padStart(2, "0")}.000Z`,
      ...overrides,
    };
  }

  it("returns latest evaluations first and applies cap", () => {
    const recent = deriveHydratedRecentFinishedOptimizationTrials({
      trials: [trial(1), trial(4), trial(2), trial(7), trial(5)],
      snapshot: { evaluationIndex: 7, generation: 2, trialCount: 7 },
      cap: 3,
    });
    expect(recent.map((r) => r.evaluationNumber)).toEqual([7, 5, 4]);
  });

  it("filters out trials newer than current snapshot", () => {
    const recent = deriveHydratedRecentFinishedOptimizationTrials({
      trials: [trial(9), trial(8), trial(7), trial(6)],
      snapshot: { evaluationIndex: 7, generation: 1, trialCount: 7 },
      cap: 10,
    });
    expect(recent.map((r) => r.evaluationNumber)).toEqual([7, 6]);
  });

  it("falls back to all persisted trials when snapshot is missing", () => {
    const recent = deriveHydratedRecentFinishedOptimizationTrials({
      trials: [trial(2), trial(3), trial(1)],
      snapshot: null,
      cap: 2,
    });
    expect(recent.map((r) => r.evaluationNumber)).toEqual([3, 2]);
  });
});

describe("sortOptimizationOverviewRows", () => {
  it("sorts by evaluation asc with nulls last and stable ties", () => {
    const rows = sortOptimizationOverviewRows({
      rows: [
        {
          id: "b",
          generation: 1,
          evaluationNumber: 3,
          metricValue: 0.4,
          mse: 0.09,
          rmse: 0.3,
          durationMs: 1000,
          finishedAt: "2026-01-01T00:00:03.000Z",
          source: "persisted",
          status: "finished",
          isBest: false,
          hasPreviewRun: false,
        },
        {
          id: "a",
          generation: 1,
          evaluationNumber: 3,
          metricValue: 0.5,
          mse: 0.04,
          rmse: 0.2,
          durationMs: 1200,
          finishedAt: "2026-01-01T00:00:04.000Z",
          source: "persisted",
          status: "finished",
          isBest: false,
          hasPreviewRun: false,
        },
        {
          id: "c",
          generation: 1,
          evaluationNumber: null,
          metricValue: null,
          mse: null,
          rmse: null,
          durationMs: null,
          finishedAt: null,
          source: "persisted",
          status: "unknown",
          isBest: false,
          hasPreviewRun: false,
        },
      ],
      key: "evaluation",
      direction: "asc",
    });
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by finishedAt desc and keeps invalid timestamps last", () => {
    const rows = sortOptimizationOverviewRows({
      rows: [
        {
          id: "older",
          generation: 1,
          evaluationNumber: 1,
          metricValue: 0.2,
          mse: 0.01,
          rmse: 0.1,
          durationMs: 800,
          finishedAt: "2026-01-01T00:00:01.000Z",
          source: "persisted",
          status: "finished",
          isBest: false,
          hasPreviewRun: false,
        },
        {
          id: "newer",
          generation: 1,
          evaluationNumber: 2,
          metricValue: 0.3,
          mse: 0.04,
          rmse: 0.2,
          durationMs: 900,
          finishedAt: "2026-01-01T00:00:02.000Z",
          source: "persisted",
          status: "finished",
          isBest: false,
          hasPreviewRun: false,
        },
        {
          id: "missing",
          generation: null,
          evaluationNumber: null,
          metricValue: null,
          mse: null,
          rmse: null,
          durationMs: null,
          finishedAt: null,
          source: "persisted",
          status: "unknown",
          isBest: false,
          hasPreviewRun: false,
        },
      ],
      key: "finishedAt",
      direction: "desc",
    });
    expect(rows.map((r) => r.id)).toEqual(["newer", "older", "missing"]);
  });
});

describe("deriveHydratedOptimizationOverviewRows", () => {
  it("maps persisted trials to normalized rows with rmse", () => {
    const rows = deriveHydratedOptimizationOverviewRows({
      trials: [
        {
          id: "trial-2",
          generation: 1,
          evaluation_index: 2,
          metric_value: 0.4,
          mse: 0.09,
          elapsed_ms: 800,
          created_at: "2026-01-01T00:00:02.000Z",
        },
      ],
      snapshot: { evaluationIndex: 2, generation: 0, trialCount: 2 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rmse).toBeCloseTo(0.3);
    expect(rows[0]?.status).toBe("finished");
    expect(rows[0]?.isBest).toBe(false);
    expect(rows[0]?.hasPreviewRun).toBe(false);
  });

  it("preserves persisted trial ids for hydrated row selection mapping", () => {
    const rows = deriveHydratedOptimizationOverviewRows({
      trials: [
        {
          id: "trial-7",
          generation: 2,
          evaluation_index: 7,
          metric_value: 0.9,
          mse: 0.01,
          elapsed_ms: 700,
          created_at: "2026-01-01T00:00:07.000Z",
        },
        {
          id: "trial-8",
          generation: 2,
          evaluation_index: 8,
          metric_value: 1.1,
          mse: 0.02,
          elapsed_ms: 750,
          created_at: "2026-01-01T00:00:08.000Z",
        },
      ],
      snapshot: { evaluationIndex: 8, generation: 2, trialCount: 8 },
    });
    expect(rows.map((r) => r.id)).toEqual(["trial-8", "trial-7"]);
    expect(rows.every((r) => r.source === "persisted")).toBe(true);
  });

  it("maps persisted best-trial flag for star rendering", () => {
    const rows = deriveHydratedOptimizationOverviewRows({
      trials: [
        {
          id: "trial-1",
          generation: 0,
          evaluation_index: 1,
          metric_value: 0.1,
          mse: 0.1,
          elapsed_ms: 1000,
          created_at: "2026-01-01T00:00:01.000Z",
          is_new_best: 0,
          has_run_payload: true,
        },
        {
          id: "trial-2",
          generation: 0,
          evaluation_index: 2,
          metric_value: 0.2,
          mse: 0.01,
          elapsed_ms: 900,
          created_at: "2026-01-01T00:00:02.000Z",
          is_new_best: 1,
          has_run_payload: true,
        },
      ],
      snapshot: { evaluationIndex: 2, generation: 0, trialCount: 2 },
    });
    expect(rows.find((row) => row.id === "trial-1")?.isBest).toBe(false);
    expect(rows.find((row) => row.id === "trial-2")?.isBest).toBe(true);
    expect(rows.every((row) => row.hasPreviewRun)).toBe(true);
  });
});

describe("overview helper utilities", () => {
  it("returns default overview ordering as latest evaluation first", () => {
    expect(getDefaultOptimizationOverviewSort()).toEqual({
      key: "evaluation",
      direction: "desc",
    });
  });

  it("derives non-contradictory trial count text for hydrated rows", () => {
    expect(
      deriveOptimizationTrialRunsCountText({
        running: false,
        totalEvalCount: 0,
        localWindowCount: 0,
        overviewCount: 3,
      }),
    ).toBe("3 finished evals");
    expect(
      deriveOptimizationTrialRunsCountText({
        running: false,
        totalEvalCount: 0,
        localWindowCount: 0,
        overviewCount: 0,
      }),
    ).toBe("No evaluations yet");
  });

  it("maps click eligibility to finished rows with ids", () => {
    expect(
      isOptimizationOverviewRowPreviewable({
        id: "trial-1",
        generation: 0,
        evaluationNumber: 1,
        metricValue: 0.1,
        mse: 0.1,
        rmse: 0.316,
        durationMs: 1000,
        finishedAt: "2026-01-01T00:00:01.000Z",
        source: "persisted",
        status: "finished",
        isBest: false,
        hasPreviewRun: true,
      }),
    ).toBe(true);
    expect(
      isOptimizationOverviewRowPreviewable({
        id: "",
        generation: null,
        evaluationNumber: null,
        metricValue: null,
        mse: null,
        rmse: null,
        durationMs: null,
        finishedAt: null,
        source: "persisted",
        status: "unknown",
        isBest: false,
        hasPreviewRun: false,
      }),
    ).toBe(false);
  });

  it("uses resolved best row id helper logic", () => {
    const row = {
      id: "trial-2",
      generation: 0,
      evaluationNumber: 2,
      metricValue: 0.2,
      mse: 0.01,
      rmse: 0.1,
      durationMs: 900,
      finishedAt: "2026-01-01T00:00:02.000Z",
      source: "persisted" as const,
      status: "finished" as const,
      isBest: false,
      hasPreviewRun: true,
    };
    expect(isOptimizationOverviewRowBest({ ...row, isBest: true }, null)).toBe(false);
    expect(isOptimizationOverviewRowBest(row, "trial-2")).toBe(true);
    expect(isOptimizationOverviewRowBest(row, "trial-7")).toBe(false);
  });

  it("derives deterministic single best row for target objective ties", () => {
    const best = deriveBestOptimizationOverviewRowId({
      objective: "target",
      rows: [
        {
          id: "trial-1",
          generation: 0,
          evaluationNumber: 1,
          metricValue: 0.5,
          mse: 0.04,
          rmse: 0.2,
          durationMs: 1100,
          finishedAt: "2026-01-01T00:00:01.000Z",
          source: "persisted",
          status: "finished",
          isBest: true,
          hasPreviewRun: true,
        },
        {
          id: "trial-2",
          generation: 0,
          evaluationNumber: 2,
          metricValue: 0.6,
          mse: 0.04,
          rmse: 0.2,
          durationMs: 900,
          finishedAt: "2026-01-01T00:00:02.000Z",
          source: "persisted",
          status: "finished",
          isBest: true,
          hasPreviewRun: true,
        },
      ],
    });
    expect(best).toBe("trial-2");
  });
});

describe("deriveOptimizationWaitingDiagnostics", () => {
  it("marks active evaluation when current eval exists", () => {
    const diag = deriveOptimizationWaitingDiagnostics({
      running: true,
      hasCurrentEvaluation: true,
      lastPersistedTrialAt: "2026-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:10.000Z"),
    });
    expect(diag.phase).toBe("evaluating");
    expect(diag.showLongWaitNote).toBe(false);
  });

  it("shows long-wait explanatory state after threshold", () => {
    const diag = deriveOptimizationWaitingDiagnostics({
      running: true,
      hasCurrentEvaluation: false,
      lastPersistedTrialAt: "2026-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:45.000Z"),
      staleThresholdMs: 30_000,
    });
    expect(diag.phase).toBe("idle");
    expect(diag.showLongWaitNote).toBe(true);
    expect(diag.sinceLastTrialWriteMs).toBe(45_000);
  });

  it("stays in waiting_to_persist before stale threshold", () => {
    const diag = deriveOptimizationWaitingDiagnostics({
      running: true,
      hasCurrentEvaluation: false,
      lastPersistedTrialAt: "2026-01-01T00:00:00.000Z",
      nowMs: Date.parse("2026-01-01T00:00:10.000Z"),
      staleThresholdMs: 30_000,
    });
    expect(diag.phase).toBe("waiting_to_persist");
    expect(diag.showLongWaitNote).toBe(false);
    expect(diag.message).toContain("Waiting for the next trial result");
  });

  it("handles running state with unknown last persisted timestamp deterministically", () => {
    const diag = deriveOptimizationWaitingDiagnostics({
      running: true,
      hasCurrentEvaluation: false,
      lastPersistedTrialAt: null,
      nowMs: Date.parse("2026-01-01T00:00:10.000Z"),
      staleThresholdMs: 30_000,
    });
    expect(diag.phase).toBe("starting");
    expect(diag.sinceLastTrialWriteMs).toBeNull();
    expect(diag.showLongWaitNote).toBe(false);
  });
});

describe("deriveOptimizationEvalTimingDisplay", () => {
  it("renders current evaluation with running time", () => {
    const display = deriveOptimizationEvalTimingDisplay({
      timing: {
        currentGeneration: 1,
        currentEvaluationIndex: 7,
        currentEvaluationStartedAt: "2026-01-01T00:00:10.000Z",
        lastEvaluationDurationMs: null,
        lastEvaluationFinishedAt: null,
      },
      nowMs: Date.parse("2026-01-01T00:00:12.500Z"),
    });
    expect(display.currentEvaluationLine).toContain("Current evaluation: Gen 2, Eval 7");
    expect(display.currentEvaluationLine).toContain("running for 2.5s");
    expect(display.lastEvaluationLine).toBeNull();
  });

  it("renders last evaluation duration and finish time", () => {
    const display = deriveOptimizationEvalTimingDisplay({
      timing: {
        currentGeneration: null,
        currentEvaluationIndex: null,
        currentEvaluationStartedAt: null,
        lastEvaluationDurationMs: 12_345,
        lastEvaluationFinishedAt: "2026-01-01T00:00:30.000Z",
      },
      nowMs: Date.parse("2026-01-01T00:00:40.000Z"),
    });
    expect(display.currentEvaluationLine).toBeNull();
    expect(display.lastEvaluationLine).toContain("Last evaluation: duration 12.3s");
    expect(display.lastEvaluationLine).toContain("finished at");
  });
});

describe("deriveOptimizationVisibleTrialRows", () => {
  it("returns all rows when not running", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `row-${i + 1}`);
    expect(
      deriveOptimizationVisibleTrialRows({
        rows,
        running: false,
        maxLiveRows: 80,
      }),
    ).toEqual(rows);
  });

  it("caps live rows to keep active render window bounded", () => {
    const rows = Array.from({ length: 125 }, (_, i) => `row-${i + 1}`);
    const visible = deriveOptimizationVisibleTrialRows({
      rows,
      running: true,
      maxLiveRows: 80,
    });
    expect(visible).toHaveLength(80);
    expect(visible[0]).toBe("row-46");
    expect(visible[79]).toBe("row-125");
  });

  it("respects small live windows", () => {
    const rows = ["a", "b", "c", "d"];
    const visible = deriveOptimizationVisibleTrialRows({
      rows,
      running: true,
      maxLiveRows: 2,
    });
    expect(visible).toEqual(["c", "d"]);
  });
});

describe("shouldRefreshHydratedOverview", () => {
  it("refreshes immediately on first hydration", () => {
    expect(
      shouldRefreshHydratedOverview({
        snapshot: null,
        lastSnapshot: null,
        nowMs: 1_000,
        lastFetchAtMs: null,
        maxIdleMs: 8_000,
      }),
    ).toBe(true);
  });

  it("skips refresh when snapshot has not advanced and idle budget not hit", () => {
    expect(
      shouldRefreshHydratedOverview({
        snapshot: { evaluationIndex: 10, generation: 1, trialCount: 10 },
        lastSnapshot: { evaluationIndex: 10, generation: 1, trialCount: 10 },
        nowMs: 5_000,
        lastFetchAtMs: 2_000,
        maxIdleMs: 8_000,
      }),
    ).toBe(false);
  });

  it("refreshes when snapshot advances", () => {
    expect(
      shouldRefreshHydratedOverview({
        snapshot: { evaluationIndex: 11, generation: 2, trialCount: 11 },
        lastSnapshot: { evaluationIndex: 10, generation: 1, trialCount: 10 },
        nowMs: 5_000,
        lastFetchAtMs: 4_000,
        maxIdleMs: 8_000,
      }),
    ).toBe(true);
  });

  it("refreshes when generation advances without eval count change", () => {
    expect(
      shouldRefreshHydratedOverview({
        snapshot: { evaluationIndex: 10, generation: 3, trialCount: 10 },
        lastSnapshot: { evaluationIndex: 10, generation: 2, trialCount: 10 },
        nowMs: 5_000,
        lastFetchAtMs: 4_500,
        maxIdleMs: 8_000,
      }),
    ).toBe(true);
  });

  it("refreshes on idle timeout even if snapshot stalls", () => {
    expect(
      shouldRefreshHydratedOverview({
        snapshot: { evaluationIndex: 10, generation: 1, trialCount: 10 },
        lastSnapshot: { evaluationIndex: 10, generation: 1, trialCount: 10 },
        nowMs: 20_500,
        lastFetchAtMs: 10_000,
        maxIdleMs: 8_000,
      }),
    ).toBe(true);
  });
});
