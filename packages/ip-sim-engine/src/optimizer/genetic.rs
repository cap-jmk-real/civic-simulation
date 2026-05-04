//! Genetic algorithm minimizing a black-box fitness \( \mathbb{R}^d \to \mathbb{R}_{\ge 0} \).
//! Uses [`crate::rng::MulBerry32`] for deterministic PRNG (parity style with TS).

use crate::rng::MulBerry32;

/// Hyperparameters for the generational GA.
#[derive(Clone, Debug)]
pub struct GeneticConfig {
    pub population_size: usize,
    pub generations: usize,
    /// Per-locus independent mutation try rate.
    pub mutation_rate: f64,
    /// Tournament size (≥ 1).
    pub tournament_k: usize,
    pub seed: u32,
}

impl Default for GeneticConfig {
    fn default() -> Self {
        Self {
            population_size: 16,
            generations: 20,
            mutation_rate: 0.12,
            tournament_k: 3,
            seed: 0x9e37_79b9,
        }
    }
}

/// Outcome of [`run_genetic_minimize`].
#[derive(Clone, Debug)]
pub struct GeneticResult {
    pub best: Vec<f64>,
    pub best_fitness: f64,
    pub generations_run: usize,
    pub evaluations: usize,
}

fn random_genes(n: usize, rng: &mut MulBerry32) -> Vec<f64> {
    (0..n).map(|_| rng.next_f64()).collect()
}

fn tournament_pick(
    scored: &[(Vec<f64>, f64)],
    rng: &mut MulBerry32,
    k: usize,
) -> Vec<f64> {
    let k = k.max(1);
    let mut best = &scored[(rng.next_f64() * scored.len() as f64) as usize % scored.len()];
    for _ in 1..k {
        let c = &scored[(rng.next_f64() * scored.len() as f64) as usize % scored.len()];
        if c.1 < best.1 {
            best = c;
        }
    }
    best.0.clone()
}

fn crossover(a: &[f64], b: &[f64], rng: &mut MulBerry32) -> Vec<f64> {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| if rng.next_f64() < 0.5 { *x } else { *y })
        .collect()
}

fn mutate(genes: &mut [f64], rate: f64, rng: &mut MulBerry32) {
    let sigma = 0.18;
    for g in genes.iter_mut() {
        if rng.next_f64() >= rate {
            continue;
        }
        // Box-Muller-ish: sum of 4 uniforms − 2, ~ N(0,1) scale
        let z = (rng.next_f64() + rng.next_f64() + rng.next_f64() + rng.next_f64() - 2.0) / 2.0;
        *g = (*g + z * sigma).clamp(1e-9, 1.0 - 1e-9);
    }
}

/// Minimize `fitness` over \((0,1)^d\). Lower is better; `fitness` must be non-negative.
pub fn run_genetic_minimize<F>(cfg: &GeneticConfig, n_genes: usize, mut fitness: F) -> GeneticResult
where
    F: FnMut(&[f64]) -> f64,
{
    let n = n_genes.max(1);
    let pop_n = cfg.population_size.max(2);
    let gen_n = cfg.generations.max(1);
    let mut rng = MulBerry32::new(cfg.seed ^ 0x51ed_f00d);

    let mut population: Vec<Vec<f64>> = (0..pop_n).map(|_| random_genes(n, &mut rng)).collect();

    let mut best_ever = (vec![0.5_f64; n], f64::INFINITY);
    let mut evaluations = 0_usize;

    for _generation in 0..gen_n {
        let mut scored: Vec<(Vec<f64>, f64)> = Vec::with_capacity(pop_n);
        for g in &population {
            let f = fitness(g);
            evaluations += 1;
            scored.push((g.clone(), f));
            if f < best_ever.1 {
                best_ever = (g.clone(), f);
            }
        }

        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        let elite_n = 2.min(pop_n);
        let mut next: Vec<Vec<f64>> = scored
            .iter()
            .take(elite_n)
            .map(|(g, _)| g.clone())
            .collect();

        while next.len() < pop_n {
            let p1 = tournament_pick(&scored, &mut rng, cfg.tournament_k);
            let p2 = tournament_pick(&scored, &mut rng, cfg.tournament_k);
            let mut child = crossover(&p1, &p2, &mut rng);
            mutate(&mut child, cfg.mutation_rate, &mut rng);
            next.push(child);
        }
        population = next;

        debug_assert_eq!(population.len(), pop_n);
    }

    GeneticResult {
        best: best_ever.0,
        best_fitness: best_ever.1,
        generations_run: gen_n,
        evaluations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_minimum_of_quadratic_bowl() {
        // Minimum at 0.35 for single gene
        let cfg = GeneticConfig {
            population_size: 24,
            generations: 40,
            mutation_rate: 0.15,
            tournament_k: 3,
            seed: 12345,
        };
        let target = 0.35_f64;
        let res = run_genetic_minimize(&cfg, 1, |g| {
            let x = g[0];
            (x - target).powi(2)
        });
        assert!(res.best_fitness < 0.02, "best_fitness={}", res.best_fitness);
        assert!((res.best[0] - target).abs() < 0.15, "best={:?}", res.best);
    }

    #[test]
    fn two_d_sphere() {
        let cfg = GeneticConfig {
            population_size: 32,
            generations: 50,
            ..Default::default()
        };
        let res = run_genetic_minimize(&cfg, 2, |g| {
            (g[0] - 0.2).powi(2) + (g[1] - 0.8).powi(2)
        });
        assert!(res.best_fitness < 0.05);
        assert!((res.best[0] - 0.2).abs() < 0.12);
        assert!((res.best[1] - 0.8).abs() < 0.12);
    }
}
