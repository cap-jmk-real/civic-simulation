import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentState, Edge } from "./types.js";
import { computeMarketShares } from "./metrics.js";

const KIND_ORDER: AgentState["type"][] = ["bigco", "academic", "smb", "solo"];

type Fixture = {
  capability_beta: number;
  spillover_alpha: number;
  type_weights: [number, number, number, number];
  knowledge: number[];
  reputation: number[];
  patent_count: number[];
  agent_kind: number[];
  edges: [number, number, number][];
  expected_raw_weights: number[];
};

function loadFixture(): Fixture {
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "../../ip-sim-engine/tests/fixtures/market_small.json");
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

function agentsFromFixture(f: Fixture): AgentState[] {
  return f.knowledge.map((knowledge, i) => {
    const t = KIND_ORDER[f.agent_kind[i]!]!;
    const pc = f.patent_count[i] ?? 0;
    const patents = Array.from({ length: pc }, (_, j) => 1000 + j);
    return {
      id: `a${i}`,
      type: t,
      civicRole: "citizen",
      publicServantFireable: true,
      wealth: 10,
      knowledge,
      patentExpiresAt: patents,
      reputation: f.reputation[i]!,
      memory: [],
      lastProfit: 0,
      cumulativeProfit: 0,
      innovationPipeline: [],
      labor: 5,
      lastOfferingQuality: 1,
    } satisfies AgentState;
  });
}

function edgesFromFixture(f: Fixture): Edge[] {
  return f.edges.map(([a, b, w]) => ({
    a: `a${a}`,
    b: `a${b}`,
    weight: w,
  }));
}

function typeWeightsFromFixture(f: Fixture): Record<AgentState["type"], number> {
  return {
    bigco: f.type_weights[0]!,
    academic: f.type_weights[1]!,
    smb: f.type_weights[2]!,
    solo: f.type_weights[3]!,
  };
}

describe("market kernel golden (vs Rust ip-sim-engine)", () => {
  it("computeMarketShares matches shared JSON fixture", () => {
    const f = loadFixture();
    const agents = agentsFromFixture(f);
    const edges = edgesFromFixture(f);
    const weights = typeWeightsFromFixture(f);
    const raw = computeMarketShares(
      agents,
      edges,
      weights,
      f.capability_beta,
      f.spillover_alpha,
    );
    const eps = 1e-9;
    for (let i = 0; i < raw.length; i++) {
      expect(raw[i]).toBeCloseTo(f.expected_raw_weights[i]!, 9);
      expect(Math.abs(raw[i]! - f.expected_raw_weights[i]!)).toBeLessThan(eps);
    }
  });
});
