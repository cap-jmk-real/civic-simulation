//! Golden vectors shared with `@ip-sim/core` — see `tests/fixtures/market_small.json`.

use ip_sim_engine::{
    build_undirected_csr,
    market_weights_seq,
    UndirectedCsr,
};
use serde::Deserialize;

#[cfg(feature = "parallel")]
use ip_sim_engine::{market_weights_par, spillover_all_par, spillover_all_seq};

#[derive(Deserialize)]
struct MarketGoldenFixture {
    capability_beta: f64,
    spillover_alpha: f64,
    type_weights: [f64; 4],
    knowledge: Vec<f64>,
    reputation: Vec<f64>,
    patent_count: Vec<f32>,
    agent_kind: Vec<u8>,
    edges: Vec<[f64; 3]>,
    expected_raw_weights: Vec<f64>,
}

impl MarketGoldenFixture {
    fn csr(&self) -> UndirectedCsr {
        let n = self.knowledge.len();
        let triples: Vec<(u32, u32, f64)> = self
            .edges
            .iter()
            .map(|e| (e[0] as u32, e[1] as u32, e[2]))
            .collect();
        build_undirected_csr(n, &triples)
    }
}

fn load_fixture() -> MarketGoldenFixture {
    let s = include_str!("fixtures/market_small.json");
    serde_json::from_str(s).expect("parse market_small.json")
}

#[test]
fn smoke_small_graph_market_weights_run() {
    let f = load_fixture();
    let n = f.knowledge.len();
    let csr = f.csr();
    let mut out = vec![0.0f64; n];
    market_weights_seq(
        &f.knowledge,
        &f.reputation,
        &f.patent_count,
        &f.agent_kind,
        &f.type_weights,
        &csr,
        f.capability_beta,
        f.spillover_alpha,
        &mut out,
    );
    assert!(out.iter().all(|w| w.is_finite() && *w > 0.0));
}

#[test]
fn golden_matches_typescript_fixture() {
    let f = load_fixture();
    let n = f.knowledge.len();
    assert_eq!(f.expected_raw_weights.len(), n);
    let csr = f.csr();
    let mut out = vec![0.0f64; n];
    market_weights_seq(
        &f.knowledge,
        &f.reputation,
        &f.patent_count,
        &f.agent_kind,
        &f.type_weights,
        &csr,
        f.capability_beta,
        f.spillover_alpha,
        &mut out,
    );
    const EPS: f64 = 1e-9;
    for (i, (&exp, &got)) in f
        .expected_raw_weights
        .iter()
        .zip(out.iter())
        .enumerate()
    {
        assert!(
            (got - exp).abs() < EPS,
            "agent {i}: got {got:.17} expected {exp:.17}"
        );
    }
}

#[cfg(feature = "parallel")]
#[test]
fn parallel_matches_sequential_small() {
    let f = load_fixture();
    let n = f.knowledge.len();
    let csr = f.csr();
    let mut seq = vec![0.0f64; n];
    let mut par = vec![0.0f64; n];
    market_weights_seq(
        &f.knowledge,
        &f.reputation,
        &f.patent_count,
        &f.agent_kind,
        &f.type_weights,
        &csr,
        f.capability_beta,
        f.spillover_alpha,
        &mut seq,
    );
    market_weights_par(
        &f.knowledge,
        &f.reputation,
        &f.patent_count,
        &f.agent_kind,
        &f.type_weights,
        &csr,
        f.capability_beta,
        f.spillover_alpha,
        &mut par,
    );
    const EPS: f64 = 1e-12;
    for i in 0..n {
        assert!(
            (seq[i] - par[i]).abs() < EPS,
            "idx {i}: seq {} par {}",
            seq[i],
            par[i]
        );
    }

    let mut s_spill = vec![0.0f64; n];
    let mut p_spill = vec![0.0f64; n];
    spillover_all_seq(&f.knowledge, &csr, f.spillover_alpha, &mut s_spill);
    spillover_all_par(&f.knowledge, &csr, f.spillover_alpha, &mut p_spill);
    for i in 0..n {
        assert!((s_spill[i] - p_spill[i]).abs() < EPS);
    }
}
