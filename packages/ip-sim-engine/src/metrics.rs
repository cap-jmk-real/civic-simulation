//! Distribution metrics — aligned with `packages/sim-core/src/metrics.ts` (finite values, nonnegative stocks).

/// Gini coefficient; NaNs ignored; empty or zero-sum → `0.0`.
pub fn gini(values: &[f64]) -> f64 {
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    let n = v.len();
    if n == 0 {
        return 0.0;
    }
    v.sort_by(f64::total_cmp);
    let sum: f64 = v.iter().sum();
    if sum == 0.0 {
        return 0.0;
    }
    let mut num = 0.0;
    for (i, &x) in v.iter().enumerate() {
        num += (2.0 * i as f64 - n as f64 + 1.0) * x;
    }
    num / (n as f64 * sum)
}

/// Herfindahl–Hirschman index on normalized nonnegative weights.
pub fn hhi(shares: &[f64]) -> f64 {
    let s: f64 = shares.iter().sum();
    if s == 0.0 {
        return 0.0;
    }
    shares.iter().map(|x| {
        let p = x / s;
        p * p
    }).sum()
}

/// Total, top-10% count cohort sum, top-1% count cohort sum (by **sorted descending** values).
pub fn stock_distribution_top_shares(values: &[f64]) -> (f64, f64, f64, f64) {
    let total: f64 = values.iter().sum();
    let mut sorted: Vec<f64> = values.to_vec();
    sorted.sort_by(|a, b| b.total_cmp(a));
    let n = sorted.len();
    let k10 = (n as f64 * 0.1).ceil().max(1.0) as usize;
    let k1 = if n == 0 { 0 } else { (n as f64 * 0.01).ceil().max(1.0) as usize };
    let top10: f64 = sorted.iter().take(k10).sum();
    let top1: f64 = if n == 0 { 0.0 } else { sorted.iter().take(k1).sum() };
    let top10_share = if total > 0.0 { top10 / total } else { 0.0 };
    (total, top10, top1, top10_share)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gini_two_person_half() {
        assert!((gini(&[0.0, 100.0]) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn hhi_two_equal() {
        assert!((hhi(&[50.0, 50.0]) - 0.5).abs() < 1e-9);
    }
}
