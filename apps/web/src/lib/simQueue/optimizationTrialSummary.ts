import type { LabTrialRow } from "./labSessionsStore";
import { hasPersistedLabTrialRunPayload } from "./labRunJsonResolver";

export type OptimizationTrialSummary = {
  id: string;
  generation: number;
  evaluation_index: number;
  metric_value: number | null;
  mse: number;
  elapsed_ms: number | null;
  is_new_best: number;
  has_run_payload: boolean;
  created_at: string;
};

export function toOptimizationTrialSummary(trial: LabTrialRow): OptimizationTrialSummary {
  return {
    id: trial.id,
    generation: trial.generation,
    evaluation_index: trial.evaluation_index,
    metric_value: trial.metric_value,
    mse: trial.mse,
    elapsed_ms: trial.elapsed_ms,
    is_new_best: trial.is_new_best,
    has_run_payload: hasPersistedLabTrialRunPayload({
      runSummaryJson: trial.run_summary_json,
      spilloverPath: trial.spillover_path,
    }),
    created_at: trial.created_at,
  };
}
