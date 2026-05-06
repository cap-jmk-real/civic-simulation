export function makeOptimizationTrialId(input: { sessionId: string; evaluationNumber: number }): string {
  // Must be globally unique (lab_trials.id is a primary key) and stable for retries.
  return `opt_${input.sessionId}_e_${input.evaluationNumber}`;
}

