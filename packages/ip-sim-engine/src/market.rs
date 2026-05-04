//! **Exact** competitive weights matching `packages/sim-core/src/metrics.ts`:
//! `computeMarketShares` / `spilloverFromGraph` (same algebra, no shortcuts).

use crate::graph_csr::UndirectedCsr;

const WEIGHT_FLOOR: f64 = 1e-6;

/// Per-agent spillover: α × Σ_{neighbors j} w_ij × K_j — identical structure to TS `spilloverFromGraph`.
#[inline]
pub fn spillover_at(
    agent: usize,
    knowledge: &[f64],
    csr: &UndirectedCsr,
    spillover_alpha: f64,
) -> f64 {
    let lo = csr.offsets[agent] as usize;
    let hi = csr.offsets[agent + 1] as usize;
    let mut s = 0.0f64;
    for k in lo..hi {
        let j = csr.neighbors[k] as usize;
        let w = csr.weights[k];
        s += w * knowledge[j];
    }
    spillover_alpha * s
}

/// Fill `spill` — **sequential**, deterministic.
pub fn spillover_all_seq(knowledge: &[f64], csr: &UndirectedCsr, alpha: f64, spill: &mut [f64]) {
    let n = knowledge.len();
    assert_eq!(spill.len(), n);
    for i in 0..n {
        spill[i] = spillover_at(i, knowledge, csr, alpha);
    }
}

/// Raw weight before normalization (same as TS `computeMarketShares` output prior to sum division).
#[inline]
pub fn raw_weight(
    knowledge: f64,
    spill: f64,
    reputation: f64,
    patent_len: f64,
    degree: f64,
    type_weight: f64,
    capability_beta: f64,
) -> f64 {
    let cap = (knowledge + spill).max(1e-9).powf(capability_beta);
    let patent_boost = 1.0 + 0.12 * patent_len;
    let rep = 1.0 + 0.05 * reputation;
    let w = type_weight * cap * patent_boost * rep * (1.0 + 0.02 * degree);
    w.max(WEIGHT_FLOOR)
}

/// Resolve default type multipliers (same order as TS `defaultSimConfig.typeWeights`).
#[inline]
pub fn type_weight_default(kind: u8) -> f64 {
    match kind {
        0 => 1.65, // bigco
        1 => 0.85, // academic
        2 => 1.05, // smb
        _ => 0.95, // solo
    }
}

/// Degree from CSR.
pub fn degrees_from_csr(csr: &UndirectedCsr, n: usize, deg: &mut [f32]) {
    assert_eq!(deg.len(), n);
    for i in 0..n {
        deg[i] = csr.degree(i) as f32;
    }
}

/// Full pipeline: spill → raw weights. **Sequential** reference.
pub fn market_weights_seq(
    knowledge: &[f64],
    reputation: &[f64],
    patent_count: &[f32],
    agent_kind: &[u8],
    type_weights: &[f64; 4],
    csr: &UndirectedCsr,
    capability_beta: f64,
    spillover_alpha: f64,
    weights_out: &mut [f64],
) {
    let n = knowledge.len();
    assert_eq!(reputation.len(), n);
    assert_eq!(patent_count.len(), n);
    assert_eq!(agent_kind.len(), n);
    assert_eq!(weights_out.len(), n);
    let mut spill = vec![0.0f64; n];
    spillover_all_seq(knowledge, csr, spillover_alpha, &mut spill);
    for i in 0..n {
        let tw = type_weights[agent_kind[i] as usize];
        let deg = csr.degree(i) as f64;
        weights_out[i] = raw_weight(
            knowledge[i],
            spill[i],
            reputation[i],
            patent_count[i] as f64,
            deg,
            tw,
            capability_beta,
        );
    }
}

// ---- parallel (feature `parallel`) -------------------------------------------------------------

#[cfg(feature = "parallel")]
pub mod parallel {
    use super::*;
    use rayon::prelude::*;

    pub fn spillover_all_par(
        knowledge: &[f64],
        csr: &UndirectedCsr,
        alpha: f64,
        spill: &mut [f64],
    ) {
        let n = knowledge.len();
        assert_eq!(spill.len(), n);
        spill
            .par_iter_mut()
            .enumerate()
            .for_each(|(i, out)| {
                *out = spillover_at(i, knowledge, csr, alpha);
            });
    }

    pub fn market_weights_par(
        knowledge: &[f64],
        reputation: &[f64],
        patent_count: &[f32],
        agent_kind: &[u8],
        type_weights: &[f64; 4],
        csr: &UndirectedCsr,
        capability_beta: f64,
        spillover_alpha: f64,
        weights_out: &mut [f64],
    ) {
        let n = knowledge.len();
        assert_eq!(weights_out.len(), n);
        let mut spill = vec![0.0f64; n];
        spillover_all_par(knowledge, csr, spillover_alpha, &mut spill);
        weights_out
            .par_iter_mut()
            .enumerate()
            .for_each(|(i, w)| {
                let tw = type_weights[agent_kind[i] as usize];
                let deg = csr.degree(i) as f64;
                *w = raw_weight(
                    knowledge[i],
                    spill[i],
                    reputation[i],
                    patent_count[i] as f64,
                    deg,
                    tw,
                    capability_beta,
                );
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph_csr::build_undirected_csr;

    #[test]
    fn matches_manual_two_agent_chain() {
        let k = vec![10.0f64, 50.0f64];
        let csr = build_undirected_csr(2, &[(0, 1, 1.0)]);
        let alpha = 0.35;
        let s0 = spillover_at(0, &k, &csr, alpha);
        assert!((s0 - alpha * 1.0 * k[1]).abs() < 1e-12);
        let s1 = spillover_at(1, &k, &csr, alpha);
        assert!((s1 - alpha * 1.0 * k[0]).abs() < 1e-12);
    }
}
