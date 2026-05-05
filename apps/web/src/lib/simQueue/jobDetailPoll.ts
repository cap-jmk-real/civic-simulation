/** Whether the queue UI should keep polling GET /api/sim/jobs/:id for live progress. */
export function shouldPollSimJobDetail(status: string | undefined): boolean {
  return status === undefined || status === "queued" || status === "running";
}
