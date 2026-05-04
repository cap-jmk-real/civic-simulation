//! Matches `packages/sim-core/src/graph.ts`.

use crate::rng::Rng01;
use crate::sim::rng_util::shuffle_in_place;
use crate::sim::types::{Agent, Edge, GraphKind, GraphPreset};

fn edge_key(a: &str, b: &str) -> String {
    if a < b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

pub fn generate_initial_edges<R: Rng01 + ?Sized>(
    agents: &[Agent],
    preset: &GraphPreset,
    rnd: &mut R,
) -> Vec<Edge> {
    let n = agents.len();
    if n < 2 {
        return Vec::new();
    }
    let ids: Vec<String> = agents.iter().map(|a| a.id.clone()).collect();
    let target_deg = preset.avg_degree.max(1).min(n as u32 - 1) as usize;
    let mut seen = std::collections::HashSet::new();
    let mut edges: Vec<Edge> = Vec::new();

    let add_edge = |a: &str, b: &str, seen: &mut std::collections::HashSet<String>, edges: &mut Vec<Edge>, rnd: &mut R| {
        let k = edge_key(a, b);
        if a == b || seen.contains(&k) {
            return;
        }
        seen.insert(k);
        edges.push(Edge {
            a: a.to_string(),
            b: b.to_string(),
            weight: 0.4 + rnd.next_f64() * 0.6,
        });
    };

    match preset.kind {
        GraphKind::Random => {
            let m = (n * target_deg) / 2;
            let mut i = 0;
            while i < m * 3 {
                if edges.len() >= m {
                    break;
                }
                i += 1;
                let a = &ids[(rnd.next_f64() * n as f64).floor() as usize % n];
                let b = &ids[(rnd.next_f64() * n as f64).floor() as usize % n];
                add_edge(a, b, &mut seen, &mut edges, rnd);
            }
        }
        GraphKind::SmallWorld => {
            let mut ring: Vec<String> = ids.clone();
            shuffle_in_place(&mut ring, rnd);
            for i in 0..n {
                for k in 1..=target_deg.min(2) {
                    let j = (i + k) % n;
                    add_edge(&ring[i], &ring[j], &mut seen, &mut edges, rnd);
                }
            }
            for i in 0..n {
                if rnd.next_f64() < 0.08 {
                    let j = (rnd.next_f64() * n as f64).floor() as usize % n;
                    add_edge(&ring[i], &ring[j], &mut seen, &mut edges, rnd);
                }
            }
        }
        GraphKind::ScaleFree => {
            if ids.len() >= 2 {
                add_edge(&ids[0], &ids[1], &mut seen, &mut edges, rnd);
            }
            let mut degree: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
            for id in &ids {
                degree.insert(id.clone(), 0);
            }
            for e in &edges {
                *degree.entry(e.a.clone()).or_insert(0) += 1;
                *degree.entry(e.b.clone()).or_insert(0) += 1;
            }
            for i in 2..n {
                let new_id = ids[i].clone();
                let mut tries = 0;
                let mut linked = false;
                while tries < n * 2 {
                    tries += 1;
                    let pick = &ids[(rnd.next_f64() * i as f64).floor() as usize % i];
                    let dsum = 2.0 * edges.len() as f64 + 1.0;
                    let p = (*degree.get(pick).unwrap_or(&0) + 1) as f64 / dsum;
                    if rnd.next_f64() < p {
                        add_edge(&new_id, pick, &mut seen, &mut edges, rnd);
                        *degree.entry(new_id.clone()).or_insert(0) += 1;
                        *degree.entry(pick.clone()).or_insert(0) += 1;
                        linked = true;
                        break;
                    }
                }
                if !linked {
                    if !edges.iter().any(|e| e.a == new_id || e.b == new_id) {
                        let pick = &ids[(rnd.next_f64() * i as f64).floor() as usize % i];
                        add_edge(&new_id, pick, &mut seen, &mut edges, rnd);
                    }
                }
            }
        }
    }
    edges
}
