import type { AnalysisBatch } from "@/lib/analysisTypes";

type MinimalRunRef = NonNullable<AnalysisBatch["runRef"]>;

function isSimJobRef(ref: MinimalRunRef | undefined): ref is Extract<MinimalRunRef, { kind: "sim_job" }> {
  return ref?.kind === "sim_job";
}

export function canHydrateSimJobBatchResult(batch: AnalysisBatch): boolean {
  return (
    batch.kind === "single" &&
    batch.status === "done" &&
    isSimJobRef(batch.runRef) &&
    typeof batch.fullRunJson !== "string" &&
    batch.simJobHydration !== "skipped"
  );
}

/** Guard for user-driven hydration only (e.g. click-to-open). */
export function shouldFetchSimJobDetailOnSelection(batch: AnalysisBatch): boolean {
  return canHydrateSimJobBatchResult(batch);
}

export function isSerializedRunJson(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { manifest?: unknown; history?: unknown };
    return parsed != null && typeof parsed === "object" && "manifest" in parsed && Array.isArray(parsed.history);
  } catch {
    return false;
  }
}

export function attachSimJobResultToBatch(batch: AnalysisBatch, resultJson: string): AnalysisBatch | null {
  if (!canHydrateSimJobBatchResult(batch)) return null;
  if (!isSerializedRunJson(resultJson)) {
    return batch.simJobHydration === "skipped" ? null : { ...batch, simJobHydration: "skipped" };
  }
  return {
    ...batch,
    fullRunJson: resultJson,
    status: "done",
    simJobHydration: "done",
  };
}

export function simJobDetailPath(jobId: string): string {
  return `/api/sim/jobs/${encodeURIComponent(jobId)}`;
}
