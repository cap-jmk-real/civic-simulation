//! Terminal-run metrics for objective-driven search (aligned with web `OptimizationMetricKey`).

use crate::sim::types::TickMetrics;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptimizationMetric {
    GiniWealth,
    MeanWealth,
    InnovationFlow,
    InnovationFlowPerAgent,
    TotalWealth,
    Top10WealthShare,
    InnovationFlowPerMeanWealth,
}

pub fn read_optimization_metric(m: &TickMetrics, key: OptimizationMetric) -> f64 {
    match key {
        OptimizationMetric::GiniWealth => m.gini_wealth,
        OptimizationMetric::MeanWealth => m.mean_wealth,
        OptimizationMetric::InnovationFlow => m.innovation_flow,
        OptimizationMetric::InnovationFlowPerAgent => {
            let n = m.agent_count.max(1) as f64;
            m.innovation_flow / n
        }
        OptimizationMetric::TotalWealth => m.total_wealth,
        OptimizationMetric::Top10WealthShare => m.top10_wealth_share,
        OptimizationMetric::InnovationFlowPerMeanWealth => {
            let mw = m.mean_wealth;
            if !mw.is_finite() || mw.abs() < 1e-18 {
                f64::NAN
            } else {
                m.innovation_flow / mw
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_metrics() -> TickMetrics {
        TickMetrics {
            tick: 1,
            total_wealth: 100.0,
            mean_wealth: 10.0,
            top10_wealth: 50.0,
            top1_percent_wealth: 20.0,
            gini_wealth: 0.42,
            top10_wealth_share: 0.5,
            total_reputation: 20.0,
            top10_reputation: 10.0,
            top1_percent_reputation: 5.0,
            gini_reputation: 0.3,
            top10_reputation_share: 0.5,
            hhi_market_share: 0.2,
            innovation_flow: 15.0,
            total_knowledge_stock: 30.0,
            global_pool: 5.0,
            power_hhi: 0.25,
            power_components_market_share_hhi: 0.1,
            power_components_patent_hhi: 0.1,
            power_components_degree_hhi: 0.05,
            regulatory_stringency: 0.4,
            regulatory_corruption: 0.0,
            externality_net_load: 0.0,
            externality_mitigated_load: 0.0,
            externality_wealth_transfer: 0.0,
            agent_count: 10,
        }
    }

    #[test]
    fn innovation_flow_per_agent_uses_count() {
        let m = sample_metrics();
        assert!((read_optimization_metric(&m, OptimizationMetric::InnovationFlowPerAgent) - 1.5).abs() < 1e-9);
    }

    #[test]
    fn innovation_flow_over_mean_wealth() {
        let m = sample_metrics();
        assert!((read_optimization_metric(&m, OptimizationMetric::InnovationFlowPerMeanWealth) - 1.5).abs() < 1e-9);
    }
}
