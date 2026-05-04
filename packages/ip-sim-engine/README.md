# `ip-sim-engine` (Rust)

High-performance primitives and the compiled path for **large-N** runs **without approximating** the market-side interaction (full CSR neighborhoods + exact spillover / weight formulas from `@ip-sim/core`).

- **`SCALING.md`** — memory notes, **150k** parallel market kernel design, roadmap for the rest of the tick.
- **Graph** — `UndirectedCsr`: undirected edges stored twice; **no sparsification shortcuts** beyond CSR layout.
- **Market** — `market_weights_par` / `spillover_all_par` (Rayon, feature `parallel`, **default on**).
- **RNG** — `MulBerry32` matches `packages/sim-core` (unit test, seed `12345`).
- **Metrics** — `gini`, `hhi`, cohort helpers.

```bash
cargo test
cargo build --release
pnpm rust:bench   # 150k agents × 10 iters — market pipeline timing (from repo root)
```

Wire into the monorepo via root scripts: `pnpm rust:test`, `pnpm rust:build`, `pnpm rust:bench`.

**Web UI:** the Next.js app runs **`@ip-sim/core` in the browser** (WASM/JS). It does **not** call the Rust crate yet; wiring would be a native addon, sidecar process, or WASM build of `ip-sim-engine`.
