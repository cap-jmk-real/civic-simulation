"use client";

import { useSyncExternalStore } from "react";
import type { ActiveLabJob } from "@/lib/labJobStore";
import {
  clearActiveLabJob,
  getLabTabId,
  isGridProgress,
  isOptimizationProgress,
  LAB_JOB_STALE_MS,
  readActiveLabJob,
  subscribeLabJobs,
} from "@/lib/labJobStore";

type LabJobBannerStore = { job: ActiveLabJob | null; tabId: string };

/** Stable reference for `useSyncExternalStore` `getServerSnapshot` (new object literals loop React). */
const LAB_JOB_BANNER_SERVER_SNAPSHOT: LabJobBannerStore = { job: null, tabId: "" };

let lastBannerSnapshot: LabJobBannerStore | null = null;

function bannerProgressEqual(
  a: ActiveLabJob["progress"],
  b: ActiveLabJob["progress"],
): boolean {
  if (isGridProgress(a) && isGridProgress(b)) {
    return a.done === b.done && a.total === b.total;
  }
  if (isOptimizationProgress(a) && isOptimizationProgress(b)) {
    return (
      a.evaluations === b.evaluations &&
      a.planned === b.planned &&
      a.generation === b.generation
    );
  }
  return false;
}

function bannerJobsEqual(a: ActiveLabJob | null, b: ActiveLabJob | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.status === b.status &&
    a.updatedAt === b.updatedAt &&
    a.startedAt === b.startedAt &&
    a.label === b.label &&
    a.ownerTabId === b.ownerTabId &&
    bannerProgressEqual(a.progress, b.progress)
  );
}

function getLabJobBannerSnapshot(): LabJobBannerStore {
  const job = readActiveLabJob();
  const tabId = getLabTabId();
  if (
    lastBannerSnapshot != null &&
    lastBannerSnapshot.tabId === tabId &&
    bannerJobsEqual(lastBannerSnapshot.job, job)
  ) {
    return lastBannerSnapshot;
  }
  lastBannerSnapshot = { job, tabId };
  return lastBannerSnapshot;
}

/** Matches `readLabJobStore` / `getLabTabId` when `window` is undefined (SSR + hydration first paint). */
function getLabJobBannerServerSnapshot(): LabJobBannerStore {
  return LAB_JOB_BANNER_SERVER_SNAPSHOT;
}

function subscribeLabJobBannerTick(onStoreChange: () => void): () => void {
  const unsub = subscribeLabJobs(onStoreChange);
  const id = window.setInterval(onStoreChange, 1000);
  return () => {
    unsub();
    window.clearInterval(id);
  };
}

type LabTab = "single" | "grid" | "optimize" | "queue";

type LabJobBannerProps = {
  labTab: LabTab;
  gridRunnerActive: boolean;
  optimizationRunnerActive: boolean;
  onRequestTab: (tab: LabTab) => void;
};

export function LabJobBanner(props: LabJobBannerProps) {
  const { job, tabId: myId } = useSyncExternalStore(
    subscribeLabJobBannerTick,
    getLabJobBannerSnapshot,
    getLabJobBannerServerSnapshot,
  );
  if (!job || job.status !== "running") return null;

  const age = Date.now() - job.updatedAt;
  const localOwns = job.ownerTabId === myId;
  const anyRunner = props.gridRunnerActive || props.optimizationRunnerActive;

  const onDetailTab =
    job.type === "grid" ? ("grid" as const) : job.type === "optimization" ? ("optimize" as const) : null;

  const hideLocalBecauseOnDetailTab =
    localOwns &&
    ((job.type === "grid" && props.labTab === "grid") ||
      (job.type === "optimization" && props.labTab === "optimize"));

  // Another tab owns the job and is still heartbeating.
  if (!localOwns && age < LAB_JOB_STALE_MS) {
    const kind = job.type === "grid" ? "Grid batch" : "Optimization";
    return (
      <div
        className="shrink-0 rounded border border-sky-900/50 bg-sky-950/35 px-2.5 py-1.5 text-[11px] text-sky-100"
        role="status"
      >
        <span className="font-medium">Run in progress in another tab</span>
        <span className="text-sky-200/85">
          {" "}
          · {kind}
          {" "}
          (progress details come from the DB-backed Queue and Optimization views)
        </span>
      </div>
    );
  }

  // Remote owner stopped heartbeating — offer dismiss so the stale row does not linger.
  if (!localOwns && age >= LAB_JOB_STALE_MS) {
    return (
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded border border-zinc-700/80 bg-zinc-900/50 px-2.5 py-1.5 text-[11px] text-zinc-200"
        role="status"
      >
        <span>
          <span className="font-medium text-zinc-100">Another tab’s run is not reporting progress</span>
          <span className="text-zinc-400">
            {" "}
            (last update {Math.round(age / 1000)}s ago). It may have closed or hung — this page did not run it.
          </span>
        </span>
        <button
          type="button"
          className="shrink-0 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-800"
          onClick={() => clearActiveLabJob()}
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Same tab/session owns the stored job but nothing is executing here (typical: full reload).
  const localInterrupted = localOwns && !anyRunner;
  if (!localInterrupted || hideLocalBecauseOnDetailTab) return null;

  const kind = job.type === "grid" ? "Grid batch" : "Optimization";

  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded border border-amber-900/55 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-100"
      role="status"
    >
      <span>
        <span className="font-medium">Previous run interrupted</span>
        <span className="text-amber-100/85">
          {" "}
          · {kind}. Reload stops in-browser work — open the {job.type === "grid" ? "Grid" : "Optimize"} tab for DB-backed
          progress details, or start again when ready.
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {onDetailTab ? (
          <button
            type="button"
            className="rounded border border-amber-800/60 px-2 py-0.5 text-[10px] text-amber-50 hover:bg-amber-950/50"
            onClick={() => props.onRequestTab(onDetailTab)}
          >
            {job.type === "grid" ? "Open Grid" : "Open Optimize"}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800/80"
          onClick={() => clearActiveLabJob()}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
