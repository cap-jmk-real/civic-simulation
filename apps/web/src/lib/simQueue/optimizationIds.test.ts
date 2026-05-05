import { describe, expect, it } from "vitest";
import { makeOptimizationTrialId } from "./optimizationIds";

describe("optimizationIds", () => {
  it("generates globally unique stable trial ids across sessions", () => {
    const a1 = makeOptimizationTrialId({ sessionId: "sess-a", evaluationNumber: 1 });
    const a2 = makeOptimizationTrialId({ sessionId: "sess-a", evaluationNumber: 2 });
    const b1 = makeOptimizationTrialId({ sessionId: "sess-b", evaluationNumber: 1 });

    expect(a1).not.toEqual(a2);
    expect(a1).not.toEqual(b1);
    expect(makeOptimizationTrialId({ sessionId: "sess-a", evaluationNumber: 1 })).toEqual(a1);
  });
});

