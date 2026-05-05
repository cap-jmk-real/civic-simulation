//! Evolutionary / genetic search over normalized gene vectors, with optional heuristic-run objectives.
//!
//! - [`genetic`] — core GA (minimize arbitrary fitness).
//! - [`genes`] — map genes into [`crate::sim::types::SimConfig`] along [`GeneAxis`] dimensions.
//! - [`metric`] — read terminal metrics from [`crate::sim::types::TickMetrics`].
//! - [`pipeline`] — end-to-end policy search with [`crate::sim::run_simulation_sync_heuristic`].

pub mod genetic;
pub mod genes;
pub mod metric;
pub mod pipeline;

pub use genes::{apply_genes_to_config, parse_gene_axis_id, GeneAxis};
pub use genetic::{run_genetic_minimize, GeneticConfig, GeneticResult};
pub use metric::{optimization_metric_from_key, read_optimization_metric, OptimizationMetric};
pub use pipeline::{
    run_policy_target_search, PolicySearchObjective, PolicySearchParams, PolicySearchResult,
};
