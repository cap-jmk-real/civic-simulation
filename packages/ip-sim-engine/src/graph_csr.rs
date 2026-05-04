//! Compact undirected graph as CSR — **full** neighborhood lists (no approximation).
//!
//! Each undirected edge `(a, b, w)` appears twice: once from `a → b` and once from `b → a`.

/// CSR adjacency: `offsets.len() == n + 1`, `neighbors.len() == offsets[n]`.
#[derive(Clone, Debug)]
pub struct UndirectedCsr {
    pub n: u32,
    pub offsets: Vec<u32>,
    pub neighbors: Vec<u32>,
    pub weights: Vec<f64>,
}

impl UndirectedCsr {
    pub fn degree(&self, i: usize) -> u32 {
        self.offsets[i + 1] - self.offsets[i]
    }
}

/// Build CSR from edge list; nodes are `0 .. n-1`. Parallel-safe after construction.
pub fn build_undirected_csr(n: usize, edges: &[(u32, u32, f64)]) -> UndirectedCsr {
    assert!(n <= u32::MAX as usize);
    let mut deg = vec![0u32; n];
    for (a, b, _) in edges {
        let ai = *a as usize;
        let bi = *b as usize;
        debug_assert!(ai < n && bi < n && ai != bi);
        deg[ai] += 1;
        deg[bi] += 1;
    }
    let mut offsets = vec![0u32; n + 1];
    for i in 0..n {
        offsets[i + 1] = offsets[i] + deg[i];
    }
    let total = offsets[n] as usize;
    let mut neighbors = vec![0u32; total];
    let mut weights = vec![0.0f64; total];
    let mut cursor: Vec<u32> = offsets[..n].to_vec();
    for (a, b, w) in edges {
        let ai = *a as usize;
        let bi = *b as usize;
        let pa = cursor[ai] as usize;
        neighbors[pa] = *b;
        weights[pa] = *w;
        cursor[ai] += 1;
        let pb = cursor[bi] as usize;
        neighbors[pb] = *a;
        weights[pb] = *w;
        cursor[bi] += 1;
    }
    UndirectedCsr {
        n: n as u32,
        offsets,
        neighbors,
        weights,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_node_edge() {
        let csr = build_undirected_csr(2, &[(0, 1, 1.5)]);
        assert_eq!(csr.offsets[1] - csr.offsets[0], 1);
        assert_eq!(csr.neighbors[csr.offsets[0] as usize], 1);
        assert_eq!(csr.neighbors[csr.offsets[1] as usize], 0);
    }
}
