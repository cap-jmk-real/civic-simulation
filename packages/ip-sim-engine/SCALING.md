# Scaling toward very large actor counts (incl. ~10⁷–10⁸)

This crate is the **compiled numerical core** intended for high throughput and, eventually, **parallel** execution. A few facts constrain what “80M actors” can mean in practice.

## Memory reality check

Storing **fully individualized** agents (wealth, knowledge, edges, memory strings, etc.) scales roughly as **O(n)** in RAM, plus **Ω(n)** or worse if you keep a dense collaboration graph.

| Rough footprint | Order of magnitude |
|-----------------|-------------------|
| ~128–256 B / agent (minimal SoA fields, no strings) | **80M × 200 B ≈ 16 GB** bare structs alone |
| Edge lists (social graph) | Often **O(n·k)** for average degree *k* — dominates quickly |
| Per-tick history | **Forbidden** at full resolution — write aggregates only |

So **80 million distinct interactive agents with graph + full logs on one host is generally not viable** without changing the model representation.

## What actually works at “national scale”

1. **Bucketed / mesoscale ABM** — Aggregate actors into strata (region × type × wealth bin); simulate counts per bucket with transition rates calibrated from the detailed `@ip-sim/core` model. Memory stays **O(buckets)** (often 10³–10⁶).

2. **Distributed sharding** — Partition agents by `id % num_shards`; each process advances its shard; exchange boundary summaries for spillovers/market clearing approximations. Needs a clear decomposition of **market** and **pool** updates (often iterative or sampled).

3. **Sparse / sampled interactions** — Full pairwise market is **O(n²)** if naive; use sampling, degree caps, or hierarchical clearing so interaction cost is **O(n log n)** or **O(n·k)**.

4. **Rust + SIMD + parallelism** — Vectorized **structure-of-arrays** layouts, `rayon` / partitioned batches, optional GPU later — good for **millions** of agents per machine **if** representation stays dense-float arrays.

5. **Mean-field / continuum limits** — Replace discrete agents with density fields when validating macro-level IP policy; reconnect to ABM for calibration only.

## Role of this crate

- **Deterministic numerics** aligned with TypeScript reference (`mulberry32`, metrics helpers).
- **Hot-path friendly**: SoA-friendly primitives; **`parallel`** feature (enabled by default) uses **Rayon** over agents for spillover + raw competitive weights.
- **Future**: FFI (C ABI) or gRPC worker so **Next.js UI** can stay thin while heavy runs execute off-thread.

## ~150k agents — **full neighborhood** market kernel (no approximation)

For **exactly** the same spillover + weight algebra as [`computeMarketShares`](../../packages/sim-core/src/metrics.ts) but **O(total stored half-edges)** instead of scanning all edges per agent:

1. **`UndirectedCsr`** stores **every** incident edge twice (undirected graph standard).
2. **`spillover_all_par`** — Rayon parallel over agents; each agent sums **only** its CSR slice \( \sum_j w_{ij} K_j \).
3. **`market_weights_par`** — parallel raw weights `τ · (K+\text{spill})^β · …` with `f64` math matching TS order.

**Rough RAM at 150k** (order of magnitude): ~150k × (several `f64` lanes for SoA state) ≈ tens of MB for state; CSR storage ≈ **2·m** entries for **m** undirected edges (here ~340k half-slots for a ring + chord topology — tune edges freely).

Run benchmark:

```bash
pnpm rust:bench
# or
cargo run --release --example bench_market_150k --manifest-path packages/ip-sim-engine/Cargo.toml
```

On a typical dev laptop **release** build, **10×** full `market_weights_par` passes over **150k** agents land around **single-digit milliseconds total** (scalpel for profiling — varies by CPU/RAM bandwidth).

**Still TypeScript-only today**: action phase, pairing, regulation externality loop, spawn — port incrementally with regression tests against `@ip-sim/core`.

## Recommended path

| Phase | Scale | Approach |
|-------|-------|----------|
| **A** | ≤ 1.5×10⁵ | **Rust** CSR graph + parallel kernels (**implemented** for market weights); JS for orchestration / parity |
| **B** | 10⁶–10⁷ | Extend Rust tick body + SoA agents; keep CSR sparse; parallel reductions where dependencies allow |
| **C** | 10⁷+ | Distributed shards **or** revisit bucketed layers — memory dominates before CPU |

Use **`pnpm`/JS core** for iteration and parity tests; promote validated kernels **here** for throughput.
