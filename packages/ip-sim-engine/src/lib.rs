//! Compiled simulation core for **large-N** runs: vectorized SoA-friendly kernels,
//! optional **Rayon** parallelism, **exact** parity with TypeScript formulas where implemented.
//!
//! - [`rng`](crate::rng) — `MulBerry32` matches `packages/sim-core/src/rng.ts`.
//! - [`sim::demand`](crate::sim::demand) — default **edge-logit** (Level B) demand on the interaction graph; set `SimConfig.demand_model` to `ContestLegacy` for the historical global pool (`packages/sim-core/SIMULATION_MATH.md` §5).
//! - [`graph_csr`](crate::graph_csr) — undirected graph as CSR (**full** adjacency).
//! - [`market`](crate::market) — spillover + competitive weights matching `computeMarketShares`.
//! - [`metrics`](crate::metrics) — Gini / HHI helpers.
//!
//! See **`SCALING.md`** for memory footnotes at ~150k+ agents.

pub mod graph_csr;
pub mod market;
pub mod metrics;
pub mod optimizer;
pub mod rng;
pub mod sim;

pub use graph_csr::{build_undirected_csr, UndirectedCsr};
pub use market::{
    degrees_from_csr, market_weights_seq, raw_weight, spillover_all_seq, spillover_at,
    type_weight_default,
};
pub use metrics::{gini, hhi, stock_distribution_top_shares};
pub use rng::{ConstantRng, MulBerry32, Rng01};

#[cfg(feature = "parallel")]
pub use market::parallel::{market_weights_par, spillover_all_par};

pub use optimizer::{
    apply_genes_to_config, read_optimization_metric, run_genetic_minimize, run_policy_target_search,
    GeneAxis, GeneticConfig, GeneticResult, OptimizationMetric, PolicySearchParams,
    PolicySearchResult,
};
