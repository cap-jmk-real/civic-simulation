//! Integration tests for policy-target genetic search (heuristic engine).

use ip_sim_engine::sim::default_sim_config;
use ip_sim_engine::{
    read_optimization_metric, run_policy_target_search, GeneAxis, GeneticConfig, OptimizationMetric,
    PolicySearchParams,
};

#[test]
fn search_best_config_matches_evaluated_genes() {
    let mut base = default_sim_config();
    base.ticks = 4;
    base.seed = 7;
    let axes = [GeneAxis::EnforcementIntensity];
    let gcfg = GeneticConfig {
        population_size: 5,
        generations: 2,
        mutation_rate: 0.25,
        tournament_k: 2,
        seed: 1,
    };

    let out = run_policy_target_search(&PolicySearchParams {
        base: &base,
        axes: &axes,
        metric: OptimizationMetric::MeanWealth,
        target: 1.0,
        genetic: gcfg,
    });

    let last = out.best_run.history.last().expect("history");
    let v = read_optimization_metric(&last.metrics, OptimizationMetric::MeanWealth);
    let mse = (v - 1.0).powi(2);
    assert!(
        mse.is_finite() && mse < 1e6,
        "finite metric, mse={} v={}",
        mse,
        v
    );
    assert_eq!(
        out.best_config.policy.enforcement_intensity,
        out.genetic.best[0]
    );
}
