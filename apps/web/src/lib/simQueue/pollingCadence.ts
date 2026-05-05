export type QueuePollingCadenceInput = {
  sseConnected: boolean;
  hasActiveRuns: boolean;
  tabVisible: boolean;
};

/**
 * SSE is the primary update channel; fallback polling stays conservative unless
 * SSE is disconnected and active runs still need timely refresh.
 */
export function queuePollingIntervalMs(input: QueuePollingCadenceInput): number {
  if (!input.tabVisible) return 60_000;
  if (input.sseConnected) return input.hasActiveRuns ? 30_000 : 45_000;
  return input.hasActiveRuns ? 7_500 : 20_000;
}
