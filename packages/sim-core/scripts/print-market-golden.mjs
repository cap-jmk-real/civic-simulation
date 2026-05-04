/**
 * One-shot helper: prints JSON lines for Rust golden fixture expectedRawWeights.
 * Usage (from repo root): node packages/sim-core/scripts/print-market-golden.mjs
 */
import { computeMarketShares } from "../dist/metrics.js";

const weights = { bigco: 1.65, academic: 0.85, smb: 1.05, solo: 0.95 };

const agents = [
  {
    id: "a0",
    type: "bigco",
    wealth: 100,
    knowledge: 25,
    patentExpiresAt: [1, 2],
    reputation: 3,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    labor: 5,
    lastOfferingQuality: 1,
  },
  {
    id: "a1",
    type: "academic",
    wealth: 50,
    knowledge: 40,
    patentExpiresAt: [],
    reputation: 1,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    labor: 5,
    lastOfferingQuality: 1,
  },
  {
    id: "a2",
    type: "smb",
    wealth: 30,
    knowledge: 15,
    patentExpiresAt: [10],
    reputation: 0,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    labor: 5,
    lastOfferingQuality: 1,
  },
  {
    id: "a3",
    type: "solo",
    wealth: 10,
    knowledge: 8,
    patentExpiresAt: [],
    reputation: -1,
    memory: [],
    lastProfit: 0,
    cumulativeProfit: 0,
    innovationPipeline: [],
    labor: 5,
    lastOfferingQuality: 1,
  },
];

const edges = [
  { a: "a0", b: "a1", weight: 1 },
  { a: "a0", b: "a2", weight: 0.5 },
  { a: "a1", b: "a2", weight: 1 },
  { a: "a1", b: "a3", weight: 2 },
];

const beta = 0.62;
const alpha = 0.35;
const raw = computeMarketShares(agents, edges, weights, beta, alpha);
console.log(JSON.stringify({ expectedRawWeights: raw }, null, 2));
