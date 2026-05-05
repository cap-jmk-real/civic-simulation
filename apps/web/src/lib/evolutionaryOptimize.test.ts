import { defaultSimConfig } from "@ip-sim/core";
import { describe, expect, it } from "vitest";
import { type EvolutionarySimulationTickPayload, runEvolutionarySearch } from "./evolutionaryOptimize";

describe("runEvolutionarySearch", () => {
  it("does not emit evaluation payloads for max-agent skipped trials", async () => {
    const base = defaultSimConfig();
    const seenEvalPayloads: number[] = [];

    const out = await runEvolutionarySearch({
      baseConfig: base,
      mode: "heuristic",
      qreTemp: 0.65,
      axisIds: ["policy.enforcementIntensity"],
      metric: "innovationFlowPerAgent",
      target: 0.05,
      objective: "target",
      maxAgentsCap: 1,
      populationSize: 4,
      generations: 1,
      mutationRate: 0.1,
      onEvaluation: (payload) => {
        seenEvalPayloads.push(payload.evaluationNumber);
      },
    });

    expect(out.evaluations).toBeGreaterThan(0);
    expect(seenEvalPayloads).toHaveLength(0);
    expect(out.bestRun.history.length).toBe(0);
  });

  it("respects explicit optimization policy mode", async () => {
    const base = defaultSimConfig();
    const seenPolicies = new Set<string>();

    await runEvolutionarySearch({
      baseConfig: base,
      mode: "heuristic",
      policyMode: "qre",
      qreTemp: 0.65,
      axisIds: ["policy.enforcementIntensity"],
      metric: "innovationFlowPerAgent",
      target: 0.05,
      objective: "target",
      populationSize: 4,
      generations: 1,
      mutationRate: 0.1,
      onEvaluation: (payload) => {
        seenPolicies.add(payload.run.manifest.policyMode);
      },
    });

    expect(seenPolicies.size).toBeGreaterThan(0);
    expect([...seenPolicies]).toEqual(["qre"]);
  });

  it("emits tick progress during evaluations via runSimulationCooperative (heuristic)", async () => {
    const base = { ...defaultSimConfig(), ticks: 20 };
    const samples: EvolutionarySimulationTickPayload[] = [];

    await runEvolutionarySearch({
      baseConfig: base,
      mode: "heuristic",
      qreTemp: 0.65,
      axisIds: ["policy.enforcementIntensity"],
      metric: "meanWealth",
      target: 0,
      objective: "maximize",
      populationSize: 2,
      generations: 1,
      mutationRate: 0.1,
      onEvaluationSimulationTick: (p) => samples.push(p),
    });

    expect(samples.length).toBeGreaterThan(0);
    const byEval = samples.filter((s) => s.evaluationNumber === 1);
    expect(byEval.length).toBeGreaterThan(0);
    expect(byEval[byEval.length - 1]!.tick).toBe(base.ticks);
    expect(byEval[byEval.length - 1]!.pct).toBeCloseTo(100, 5);
  });

  it("emits tick progress for qre policy (same cooperative path as queue jobs)", async () => {
    const base = { ...defaultSimConfig(), ticks: 18 };
    const samples: EvolutionarySimulationTickPayload[] = [];

    await runEvolutionarySearch({
      baseConfig: base,
      mode: "heuristic",
      policyMode: "qre",
      qreTemp: 0.65,
      axisIds: ["policy.enforcementIntensity"],
      metric: "meanWealth",
      target: 0,
      objective: "maximize",
      populationSize: 2,
      generations: 1,
      mutationRate: 0.1,
      onEvaluationSimulationTick: (p) => samples.push(p),
    });

    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((s) => s.tick))).toBe(base.ticks);
  });
});
