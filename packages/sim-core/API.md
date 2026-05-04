# `@ip-sim/core` — public API reference

All symbols below are exported from the package entry [`src/index.ts`](src/index.ts). Types live in [`src/types.ts`](src/types.ts); this document focuses on **functions** and **callable factories** with explicit parameters and behavior. The same descriptions are mirrored as **`/** JSDoc */`** on the corresponding exports in `src/**/*.ts` for IDE hover text.

---

## Table of contents

1. [Configuration](#configuration)
2. [Randomness](#randomness)
3. [Metrics](#metrics)
4. [Production (CES quality)](#production-ces-quality)
5. [Observations](#observations)
6. [Engine (world + simulation)](#engine-world--simulation)
7. [Graph](#graph)
8. [Serialization](#serialization)
9. [Policies](#policies)
10. [Regulation & externalities](#regulation--externalities)
11. [Constants and types](#constants-and-types)
12. [Internal utilities (not re-exported)](#internal-utilities-not-re-exported)

---

## Configuration

### `defaultSimConfig(): SimConfig`

Returns a complete **default** [`SimConfig`](src/types.ts): population counts, policy vector, graph preset, economy parameters (market size, **demand model** defaulting to edge-logit, capability β, spillover α), R&D cost knobs, depreciation, and CES quality settings. Safe to mutate a copy; prefer `mergeSimConfig` for partial overrides.

### `mergeSimConfig(overrides?: Partial<SimConfig>): SimConfig`

**Parameters**

- `overrides` — Partial top-level config; nested `policy`, `agentCounts`, `typeWeights`, and `graph` are **deep-merged** with defaults so missing keys keep defaults.

**Returns** — A full `SimConfig` suitable for `createWorld` / `runSimulationSync`.

**Behavior** — Ensures older saved JSON or hand-written partials still produce valid worlds.

---

## Randomness

### `mulberry32(seed: number): () => number`

**Returns** — A deterministic PRNG function `rnd` with `rnd()` ∈ `[0, 1)`.

**Use** — Same integer `seed` yields the same stream; used throughout the engine for actions, pairing, and shocks.

### `shuffleInPlace<T>(arr: T[], rnd: () => number): void`

**Parameters**

- `arr` — Array mutated in place (Fisher–Yates).
- `rnd` — Random source (typically `mulberry32(...)`).

**Behavior** — Uniform shuffle using `rnd`.

---

## Metrics

### `gini(values: number[]): number`

**Parameters** — Numeric array (e.g. wealth or reputation per agent).

**Returns** — Gini coefficient in `[0, 1]`; `0` for empty or all-zero sum.

### `hhi(shares: number[]): number`

**Parameters** — Nonnegative weights or counts (not necessarily normalized).

**Returns** — Herfindahl–Hirschman index of normalized shares; `0` if sum is `0`.

### `stockDistribution(values: number[]): { total, top10Sum, top1Sum, gini, top10Share }`

**Parameters** — Per-agent nonnegative stocks (wealth, reputation, etc.).

**Returns**

- `total` — Sum of values.
- `top10Sum` / `top1Sum` — Sum held by richest **ceil(n·10%)** and **max(1, ceil(n·1%))** agents by descending sort.
- `gini` — `gini(values)`.
- `top10Share` — `top10Sum / total` (or `0` if `total` is `0`).

### `computeMarketShares(agents, edges, weightsByType, capabilityBeta, spilloverAlpha): number[]`

**Parameters**

- `agents` — All [`AgentState`](src/types.ts) rows.
- `edges` — Undirected edges with `weight`.
- `weightsByType` — Baseline competitive weight per `AgentType`.
- `capabilityBeta` — β in `(knowledge + spill)^β`.
- `spilloverAlpha` — Scales neighbor knowledge spillover into effective capability.

**Returns** — Strictly positive **competitive weights** (one per agent), same order as `agents`. Used for **buyer budgets** in edge-logit demand, for the legacy contest pool when `demandModel: "contest_legacy"`, and by `computeTickMetrics` for HHI.

### `computeBaseRevenues(agents, edges, cfg, marketSize, globalPool, shares, sumW, qualities, patentRegime, rnd): number[]`

**Module** — [`demand.ts`](src/demand.ts).

**Behavior** — If `cfg.demandModel === "edge_logit"` (default), each agent splits budget `marketSize · (shares[i]/sumW)` across {self ∪ graph neighbors} with a softmax over utilities (quality, reputation, knowledge, tie strength); incoming sums conserve `marketSize` before licenses. If `cfg.demandModel === "contest_legacy"`, uses the historical global share formula. Patents and the `none`-regime multiplier match [`SIMULATION_MATH.md`](SIMULATION_MATH.md) §5.3–5.4.

### `computeTickMetrics(world: WorldState, innovationFlow: number): TickMetrics`

**Parameters**

- `world` — After a full `applyStep` (or consistent snapshot).
- `innovationFlow` — Scalar returned by `applyStep` for that tick (R&D / publish / collaboration increments).

**Returns** — [`TickMetrics`](src/types.ts): wealth and reputation concentration, HHI of market weights, innovation flow, knowledge stock, global pool, composite power HHI and components.

---

## Production (CES quality)

### `cesAggregate(knowledge, labor, alpha, rho, scale): number`

**Formula** — CES output scale  
\(A \cdot [\alpha K^{\rho} + (1-\alpha) L^{\rho}]^{1/\rho}\) with `scale` as \(A\). If \(|\rho|\) is below a tiny threshold, uses **Cobb–Douglas** \(A \cdot K^{\alpha} L^{1-\alpha}\).

**Parameters**

- `knowledge`, `labor` — Floored to a small ε to avoid `log(0)`.
- `alpha` — Weight on knowledge ∈ `[0, 1]`.
- `rho` — Substitution parameter (not elasticity σ directly).
- `scale` — Overall scale factor.

### `serviceLaborShare(agentType: AgentType): number`

**Returns** — Fraction of **total labor** allocated to the **services** branch in `[0, 1]` (academic highest, bigco lowest). Used only inside `offeringQuality` for splitting labor.

### `offeringQuality(agent, cfg): number`

**Parameters**

- `agent` — `{ type, knowledge, labor }`.
- `cfg` — Must include CES fields on [`SimConfig`](src/types.ts).

**Returns** — If `!cfg.cesQualityEnabled`, returns **`1`**. Otherwise returns  
`cesMixGoods * CES(K, L_goods) + (1 - cesMixGoods) * CES(K, L_services)`  
with labor split using `serviceLaborShare(type)`.

---

## Observations

### `buildObservation(agent: AgentState, world: WorldState): AgentObservation`

**Returns** — Serializable view for policies / LLM: identity, tick, wealth, knowledge, **labor**, patent count, reputation, neighbor list with edge weights, pool, market size, policy, memory, last profit, **lastOfferingQuality**, pending R&D pipeline length.

**Note** — Does not mutate `agent` or `world`.

---

## Engine (world + simulation)

### `createAgentsFromCounts(counts: Record<AgentType, number>): AgentState[]`

**Parameters** — Counts of bigco / academic / smb / solo.

**Returns** — New agents with starting wealth, knowledge, **labor** (type-dependent), reputation, empty patents, memory, zero profits, empty innovation pipeline, `lastOfferingQuality = 1`.

### `createWorld(config?: SimConfig): WorldState`

**Parameters** — Defaults via `mergeSimConfig(config)` when partial.

**Returns** — `tick = 0`, agents from counts, **initial edges** from `generateInitialEdges`, `globalPool = 12`, `marketSize = config.baseMarketSize`, `config` stored.

### `applyStep(world: WorldState, opts: StepOptions): number`

**Parameters**

- `world` — Mutable world state.
- `opts.actions` — Map `agentId → Action`.
- `opts.rnd` — `() => number` in `[0, 1)`.

**Returns** — **Innovation flow** scalar for the tick (sum of knowledge-type increments from R&D, publish, collaboration, etc.).

**Phases (high level)** — Delayed R&D completion → action phase (invest, publish, patent, collaborate, **trade**, enforce) → collaboration pairing → trade pairing → stipends → **market revenue** (default **edge-logit** on the graph; optional **contest legacy**; CES may scale revenue and adjust reputation) → depreciation → patent expiry → tick increment → pool decay.

### `validateAction(a: string): a is Action`

**Returns** — `true` iff `a` is one of [`ACTIONS`](src/types.ts).

### `runSimulationSync(options): SimulationRun & { finalWorld: WorldState }`

**Parameters**

- `options.config` — Optional `SimConfig` (merged with defaults).
- `options.manifest` — Seed, policy mode, optional QRE temperature / LLM model.
- `options.decide(world, agent)` — Synchronous policy returning an `Action`.

**Returns** — Full [`SimulationRun`](src/types.ts) (`manifest`, `history` of [`TickRecord`](src/types.ts)) plus **`finalWorld`** after the last tick.

### `runSimulationAsync(options): Promise<Same as sync>`

Same as `runSimulationSync`, but `decide` may return a `Promise<Action>` (e.g. LLM).

### `StepOptions` (interface)

- `actions: Record<string, Action>`
- `rnd: () => number`

---

## Graph

### `generateInitialEdges(agents, preset, rnd): Edge[]`

**Parameters**

- `agents` — Used for ids only; length `n ≥ 2` required for any edges.
- `preset` — [`GraphPreset`](src/types.ts): `kind` ∈ `random` | `small_world` | `scale_free`, `avgDegree` hint.
- `rnd` — Random source.

**Returns** — Undirected edges `{ a, b, weight }` with random weights in a bounded range; duplicate pairs avoided. Empty if `n < 2`.

---

## Serialization

### `serializeRun(run: SimulationRun): string`

Pretty-printed `JSON.stringify(run, null, 2)`.

### `parseRun(json: string): SimulationRun`

`JSON.parse` cast to `SimulationRun` (no schema validation).

---

## Policies

### `heuristicPolicy(agent: AgentState, world: WorldState): Action`

Rule-based baseline: type- and policy-dependent mixture of invest, publish, patent, enforce, collaborate, **trade**, idle. Uses deterministic pseudo-randomness from agent id + tick (no shared RNG).

### `qrePolicy(agent: AgentState, world: WorldState, opts: QreOptions): Action`

**Parameters**

- `opts.temperature` — Softmax temperature (quantal response); lower ⇒ sharper argmax.
- `opts.seedSalt` — Mixed into `mulberry32` for stochastic tie-breaking.

**Returns** — Sampled action from softmax over linear **scoreFeatures** on [`buildObservation`](src/observe.ts) (includes reputation, **lastOfferingQuality**, **regulatory**, **population** / **spawn** flags; actions include **`bribe_regulator`** and **`spawn_agent`** when enabled).

### `QreOptions` (interface)

- `temperature: number`
- `seedSalt: number`

---

## Regulation & externalities

Configuration lives in [`SimConfig.regulatory`](src/types.ts) and policymaker ambition in [`PolicyVector.regulatoryAmbition`](src/types.ts). When `regulatory.enabled`, each tick aggregates **signed** goods- and services-channel loads from [`offeringQualityBranches`](src/production.ts), allocates wealth/reputation transfers by `victimVulnerability`, and mitigates **positive** net harm using effective stringency (`fixed` vs `dynamic` `ruleMode`). The action **`bribe_regulator`** spends `bribe.baseCost`, may increase **corruption** if undetected, or applies **wealth / reputation / knowledge** penalties if detected.

### `offeringQualityBranches(agent, cfg): { qGood, qServ, q }`

CES branch outputs for goods vs services (same as blended [`offeringQuality`](src/production.ts)); used for externality accounting.

### `clamp01(x)`, `effectiveStringencyFromState(...)`, `computeNetExternalityLoad(agents, cfg)`, `mitigationBaselineStringency(world, cfg)`, `advanceRegulatoryStringency(world, cfg, rnd)`

Pure helpers for regulation math and world updates (see [`src/regulatory.ts`](src/regulatory.ts)).

---

## Constants and types

### `ACTIONS` (const array)

Ordered list of valid action strings (includes `bribe_regulator`, `spawn_agent`); drives `Action` type and policy enums.

### Exported TypeScript types

See [`src/types.ts`](src/types.ts): `Action`, `AgentType`, `PatentRegime`, `PolicyVector`, `RegulatoryConfig`, `RegulatoryBribeConfig`, `RegulatoryWorldState`, `LastRegulatoryTick`, `SpawnConfig`, `GraphPreset`, `SimConfig`, `PendingInnovation`, `MemoryEvent`, `AgentState`, `Edge`, `WorldState`, `AgentObservation`, `TickMetrics`, `TickRecord`, `RunManifest`, `SimulationRun`.

---

## Internal utilities (not re-exported)

These modules are used by the engine but **not** exported from [`index.ts`](src/index.ts):

| Module | Symbol | Role |
|--------|--------|------|
| [`src/memory.ts`](src/memory.ts) | `pushMemory` | Append agent memory line; trim to max slots; optional decay drop. |

If you need them, import from `@ip-sim/core/../src/memory.js` in development only, or duplicate logic — they are **not** part of the stable public API.

---

## See also

- **[SIMULATION_MATH.md](SIMULATION_MATH.md)** — tick ordering, formulas, metric definitions, and relation between [`engine`](src/engine.ts), [`metrics`](src/metrics.ts), [`production`](src/production.ts), and [`regulatory`](src/regulatory.ts).
- Root [README.md](../../README.md) — monorepo layout, UI, scripts.
- Vitest tests under [`src/*.test.ts`](src/) — executable specs per atomic module (see §13 of SIMULATION_MATH.md).
