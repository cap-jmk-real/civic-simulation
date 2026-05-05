import type { SimJobSummaryDto } from "./parseJobsResponse";

export type LabSessionHydrationSummary = {
  id: string;
  sessionType: string;
  status: string;
  createdAt?: string;
  updatedAt: string;
  trialCount: number;
  cellCount: number;
  meta?: unknown;
};

export type ActiveRunHydrationState = {
  singleJob: SimJobSummaryDto | null;
  gridSession: LabSessionHydrationSummary | null;
  optimizationSession: LabSessionHydrationSummary | null;
};

function asMillis(ts: string): number {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function pickActiveSingleJob(jobs: SimJobSummaryDto[]): SimJobSummaryDto | null {
  const candidates = jobs.filter((j) => j.status === "running" || j.status === "queued");
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aRank = a.status === "running" ? 0 : 1;
    const bRank = b.status === "running" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return asMillis(b.updated_at) - asMillis(a.updated_at);
  });
  return candidates[0] ?? null;
}

function pickRunningSession(
  sessions: LabSessionHydrationSummary[],
  sessionType: "grid_batch" | "optimization",
): LabSessionHydrationSummary | null {
  const matches = sessions
    .filter((s) => s.sessionType === sessionType && (s.status === "running" || s.status === "queued"))
    .sort((a, b) => asMillis(b.updatedAt) - asMillis(a.updatedAt));
  matches.sort((a, b) => {
    const aRank = a.status === "running" ? 0 : 1;
    const bRank = b.status === "running" ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return asMillis(b.updatedAt) - asMillis(a.updatedAt);
  });
  return matches[0] ?? null;
}

export function deriveActiveRunHydrationState(input: {
  jobs: SimJobSummaryDto[];
  sessions: LabSessionHydrationSummary[];
}): ActiveRunHydrationState {
  return {
    singleJob: pickActiveSingleJob(input.jobs),
    gridSession: pickRunningSession(input.sessions, "grid_batch"),
    optimizationSession: pickRunningSession(input.sessions, "optimization"),
  };
}
