//! Map normalized genes \( \in (0,1) \) into [`SimConfig`](crate::sim::types::SimConfig) patches.
//! Bounds follow the same intent as the web grid’s default policy sweeps (0–1 policy scalars, etc.).

use crate::sim::types::SimConfig;

/// Which model dimensions are free in a genetic search (order matches gene vector index).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeneAxis {
    /// `policy.enforcement_intensity` in \([0,1]\).
    EnforcementIntensity,
    /// `policy.open_science_subsidy` in \([0,1]\).
    OpenScienceSubsidy,
    /// `policy.data_sharing_mandate_strength` in \([0,1]\).
    DataSharingMandateStrength,
    /// `policy.regulatory_ambition` in \([0,1]\).
    RegulatoryAmbition,
    /// `policy.patent_duration_ticks` in \([8, 120]\) (int).
    PatentDurationTicks,
    /// `policy.litigation_cost_multiplier` in \([0.5, 2.0]\).
    LitigationCostMultiplier,
    /// `capability_beta` in \([0.2, 0.95]\).
    CapabilityBeta,
    /// `spillover_alpha` in \([0.05, 0.6]\).
    SpilloverAlpha,
}

#[inline]
fn clamp01_u(u: f64) -> f64 {
    u.clamp(1e-9, 1.0 - 1e-9)
}

/// Lerp from gene `u` in (0,1) to `[lo, hi]`.
fn lerp_u(u: f64, lo: f64, hi: f64) -> f64 {
    let t = clamp01_u(u);
    lo + t * (hi - lo)
}

/// Apply `genes` to a **clone** of `base` in axis order; does not borrow `genes` after return.
pub fn apply_genes_to_config(base: &SimConfig, axes: &[GeneAxis], genes: &[f64]) -> SimConfig {
    let mut c = base.clone();
    for (i, ax) in axes.iter().enumerate() {
        let u = genes.get(i).copied().unwrap_or(0.5);
        match ax {
            GeneAxis::EnforcementIntensity => c.policy.enforcement_intensity = clamp01_u(u),
            GeneAxis::OpenScienceSubsidy => c.policy.open_science_subsidy = clamp01_u(u),
            GeneAxis::DataSharingMandateStrength => c.policy.data_sharing_mandate_strength = clamp01_u(u),
            GeneAxis::RegulatoryAmbition => c.policy.regulatory_ambition = clamp01_u(u),
            GeneAxis::PatentDurationTicks => {
                c.policy.patent_duration_ticks = lerp_u(u, 8.0, 120.0).round() as u32;
            }
            GeneAxis::LitigationCostMultiplier => {
                c.policy.litigation_cost_multiplier = lerp_u(u, 0.5, 2.0);
            }
            GeneAxis::CapabilityBeta => c.capability_beta = lerp_u(u, 0.2, 0.95),
            GeneAxis::SpilloverAlpha => c.spillover_alpha = lerp_u(u, 0.05, 0.6),
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::default_sim_config;

    #[test]
    fn enforcement_maps_unit_interval() {
        let base = default_sim_config();
        let axes = [GeneAxis::EnforcementIntensity];
        let c = apply_genes_to_config(&base, &axes, &[0.25]);
        assert!((c.policy.enforcement_intensity - 0.25).abs() < 1e-6);
    }

    #[test]
    fn patent_duration_int_in_range() {
        let base = default_sim_config();
        let axes = [GeneAxis::PatentDurationTicks];
        let c = apply_genes_to_config(&base, &axes, &[0.0]);
        assert!((8..=120).contains(&c.policy.patent_duration_ticks));
        let c2 = apply_genes_to_config(&base, &axes, &[1.0]);
        assert!((8..=120).contains(&c2.policy.patent_duration_ticks));
    }
}
