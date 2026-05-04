//! Benchmark: **150k agents**, **full** CSR neighborhoods, **parallel** spill + weight kernels.
//!
//! ```bash
//! cargo run --release --example bench_market_150k --manifest-path packages/ip-sim-engine/Cargo.toml
//! ```

use ip_sim_engine::graph_csr::build_undirected_csr;
use ip_sim_engine::market::parallel::market_weights_par;
use ip_sim_engine::rng::MulBerry32;
use std::time::Instant;

const N: usize = 150_000;

fn main() {
    let type_weights = [1.65_f64, 0.85, 1.05, 0.95];
    let capability_beta = 0.62_f64;
    let spillover_alpha = 0.35_f64;

    // Full interaction topology: ring + chords (no sampled / mean-field shortcuts).
    let mut edges: Vec<(u32, u32, f64)> = Vec::new();
    for i in 0..N {
        let a = i as u32;
        let b = ((i + 1) % N) as u32;
        edges.push((a, b, 0.42 + (i % 17) as f64 * 0.001));
    }
    for i in (0..N).step_by(9) {
        let a = i as u32;
        let b = ((i + N / 5) % N) as u32;
        if a != b {
            edges.push((a, b, 0.38));
        }
    }
    for i in (0..N).step_by(53) {
        let a = i as u32;
        let b = ((i * 7 + 101) % N) as u32;
        if a != b {
            edges.push((a, b, 0.33));
        }
    }

    let csr = build_undirected_csr(N, &edges);
    println!(
        "CSR built: n={} nodes, {} stored neighbor slots (undirected, duplicated)",
        N,
        csr.neighbors.len()
    );

    let mut rnd = MulBerry32::new(0x_cafe_beef);
    let mut knowledge = vec![0.0f64; N];
    let mut reputation = vec![0.0f64; N];
    let mut patents = vec![0.0f32; N];
    let mut kind = vec![0u8; N];
    for i in 0..N {
        knowledge[i] = 5.0 + rnd.next_f64() * 45.0;
        reputation[i] = 0.8 + rnd.next_f64() * 2.0;
        patents[i] = (rnd.next_f64() * 4.0) as f32;
        kind[i] = (rnd.next_f64() * 4.0) as u8 % 4;
    }

    let mut weights = vec![0.0f64; N];

    // Warm-up (JIT / cache)
    market_weights_par(
        &knowledge,
        &reputation,
        &patents,
        &kind,
        &type_weights,
        &csr,
        capability_beta,
        spillover_alpha,
        &mut weights,
    );

    let t0 = Instant::now();
    for _ in 0..10 {
        market_weights_par(
            &knowledge,
            &reputation,
            &patents,
            &kind,
            &type_weights,
            &csr,
            capability_beta,
            spillover_alpha,
            &mut weights,
        );
    }
    let elapsed = t0.elapsed();
    let sum_w: f64 = weights.iter().sum();

    println!(
        "10 × parallel market_weights ({} agents): {:?}  (~ {:?} / tick)",
        N,
        elapsed,
        elapsed / 10
    );
    println!("Sanity: sum(raw weights) = {:.4}", sum_w);
}
