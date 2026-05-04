//! WASM surface for `ip-sim-engine`: market weights kernel + full **heuristic** runs (JSON in/out).

mod config_from_json;
mod ts_export;

use ip_sim_engine::{build_undirected_csr, market_weights_seq};
use ip_sim_engine::sim::run_simulation_sync_heuristic;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Run `config.ticks` steps with the built-in Rust heuristic policy.
/// `config_json` must be a full browser `SimConfig` object (`@ip-sim/core` shape, camelCase).
/// Returns pretty-printed JSON: `{ manifest, history, finalWorld }` matching `runSimulationSync`.
#[wasm_bindgen]
pub fn run_simulation_heuristic_json(config_json: &str) -> String {
    match config_from_json::parse_sim_config_json(config_json) {
        Ok((cfg, config_val)) => {
            let run = run_simulation_sync_heuristic(cfg);
            ts_export::heuristic_run_to_ts_json(&run, config_val)
        }
        Err(e) => {
            wasm_bindgen::throw_str(&e);
        }
    }
}

/// Returns per-agent **raw** competitive weights (not normalized to sum 1).
///
/// - `n`: number of agents (node ids `0..n-1`).
/// - `edge_triples`: flat `[a0, b0, w0, a1, b1, w1, ...]`; `a*`,`b*` are whole `f64` values.
/// - `type_weights`: **four** entries: bigco, academic, smb, solo (same order as TS `typeWeights` keys).
#[wasm_bindgen]
pub fn market_raw_weights(
    n: u32,
    knowledge: &[f64],
    reputation: &[f64],
    patent_count: &[f32],
    agent_kind: &[u8],
    type_weights: &[f64],
    edge_triples: &[f64],
    capability_beta: f64,
    spillover_alpha: f64,
) -> Vec<f64> {
    if type_weights.len() != 4 {
        panic!("type_weights must have length 4");
    }
    let n = n as usize;
    if knowledge.len() != n
        || reputation.len() != n
        || patent_count.len() != n
        || agent_kind.len() != n
    {
        panic!("per-agent slices must have length n");
    }
    if edge_triples.len() % 3 != 0 {
        panic!("edge_triples length must be a multiple of 3");
    }
    let mut edges = Vec::with_capacity(edge_triples.len() / 3);
    for t in edge_triples.chunks_exact(3) {
        edges.push((t[0] as u32, t[1] as u32, t[2]));
    }
    let csr = build_undirected_csr(n, &edges);
    let tw: [f64; 4] = [
        type_weights[0],
        type_weights[1],
        type_weights[2],
        type_weights[3],
    ];
    let mut out = vec![0.0f64; n];
    market_weights_seq(
        knowledge,
        reputation,
        patent_count,
        agent_kind,
        &tw,
        &csr,
        capability_beta,
        spillover_alpha,
        &mut out,
    );
    out
}
