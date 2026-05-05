//! Heuristic simulation + genetic search against a terminal metric (target MSE or maximize).

use crate::optimizer::genes::{apply_genes_to_config, GeneAxis};
use crate::optimizer::genetic::{run_genetic_minimize, GeneticConfig, GeneticResult};
use crate::optimizer::metric::{read_optimization_metric, OptimizationMetric};
use crate::sim::{run_simulation_sync_heuristic, SimulationRun, SimConfig};

/// How [`run_policy_target_search`] maps the terminal metric to scalar fitness (minimize).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PolicySearchObjective {
    /// Minimize \((\text{metric} - \text{target})^2\).
    Target { target: f64 },
    /// Maximize terminal metric (internally minimize \(-\text{metric}\)).
    Maximize,
}

/// Full search: genetic optimization of policy / kernel genes toward a scalar outcome.
#[derive(Clone, Debug)]
pub struct PolicySearchParams<'a> {
    pub base: &'a SimConfig,
    pub axes: &'a [GeneAxis],
    pub metric: OptimizationMetric,
    pub objective: PolicySearchObjective,
    pub genetic: GeneticConfig,
}

#[derive(Clone, Debug)]
pub struct PolicySearchResult {
    pub genetic: GeneticResult,
    pub best_config: SimConfig,
    pub best_run: SimulationRun,
}

/// Run GA over heuristic runs: fitness is MSE to a target or \(-\text{metric}\) when maximizing.
pub fn run_policy_target_search(params: &PolicySearchParams<'_>) -> PolicySearchResult {
    let base = params.base.clone();
    let axes: Vec<GeneAxis> = params.axes.to_vec();
    let metric = params.metric;
    let objective = params.objective;
    let gcfg = params.genetic.clone();

    let genetic_res = run_genetic_minimize(&gcfg, axes.len(), |genes| {
        let cfg = apply_genes_to_config(&base, &axes, genes);
        let run = run_simulation_sync_heuristic(cfg);
        let last = run.history.last();
        if let Some(rec) = last {
            let v = read_optimization_metric(&rec.metrics, metric);
            if v.is_finite() {
                match objective {
                    PolicySearchObjective::Target { target } => (v - target).powi(2),
                    PolicySearchObjective::Maximize => -v,
                }
            } else {
                1e12
            }
        } else {
            1e12
        }
    });

    let best_cfg = apply_genes_to_config(&base, &axes, &genetic_res.best);
    let best_run = run_simulation_sync_heuristic(best_cfg.clone());

    PolicySearchResult {
        genetic: GeneticResult {
            evaluations: genetic_res.evaluations + 1,
            ..genetic_res
        },
        best_config: best_cfg,
        best_run,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::default_sim_config;

    #[test]
    fn heuristic_search_runs_and_returns_finite_fitness() {
        let base = default_sim_config();
        let mut short = base.clone();
        short.ticks = 6;
        short.seed = 99;

        let axes = [GeneAxis::EnforcementIntensity, GeneAxis::OpenScienceSubsidy];
        let gcfg = GeneticConfig {
            population_size: 6,
            generations: 2,
            mutation_rate: 0.2,
            tournament_k: 2,
            seed: 42,
        };

        let out = run_policy_target_search(&PolicySearchParams {
            base: &short,
            axes: &axes,
            metric: OptimizationMetric::GiniWealth,
            objective: PolicySearchObjective::Target { target: 0.5 },
            genetic: gcfg,
        });

        assert!(out.genetic.best_fitness.is_finite());
        assert!(!out.best_run.history.is_empty());
        assert_eq!(out.best_run.history.len(), short.ticks as usize);
    }
}
