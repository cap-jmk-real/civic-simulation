export type SimResultHydrationGateInput = {
  runnerActive: boolean;
  inFlight: boolean;
  candidateCount: number;
};

/** Skip expensive result hydration when the UI is under active run load. */
export function shouldSkipSimResultHydration(input: SimResultHydrationGateInput): boolean {
  if (input.runnerActive) return true;
  if (input.inFlight) return true;
  return input.candidateCount < 1;
}

export function capHydrationCandidates<T>(items: T[], limit: number): T[] {
  if (!Number.isFinite(limit) || limit < 1) return [];
  if (items.length <= limit) return items;
  return items.slice(0, Math.floor(limit));
}
