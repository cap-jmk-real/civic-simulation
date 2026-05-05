/**
 * Coarse-grained durable job state for the IP lab (grid batch + evolutionary optimization).
 *
 * Persists to `localStorage`, syncs across tabs via the `storage` event, and notifies same-origin
 * listeners immediately via `BroadcastChannel('ip-lab-jobs')` (the `storage` event does not fire in
 * the tab that wrote the key).
 *
 * **Limitation:** True multi-device continuation or server-side execution needs a backend job queue.
 * This module only helps the same browser profile: restore honest status after refresh (JS cannot
 * resume mid-flight) and surface multi-tab awareness on the same origin.
 */

export const LAB_JOB_STORAGE_KEY = "ip-lab-active-job";

/** Channel name for cross-tab instant notifications (supplements `storage` events). */
export const LAB_JOB_BROADCAST_CHANNEL = "ip-lab-jobs";

/** No heartbeat/progress bump for this long ⇒ treat remote “running” as dead for the global banner. */
export const LAB_JOB_STALE_MS = 30_000;

/** While the owner tab is alive it should bump `updatedAt` at least this often (progress callbacks may stall on long WASM cells). */
export const LAB_JOB_HEARTBEAT_MS = 2_000;

const TAB_SESSION_KEY = "ip-lab-tab-id";

export type LabJobType = "grid" | "optimization";

export type LabJobGridProgress = { done: number; total: number };

export type LabJobOptimizationProgress = {
  evaluations: number;
  planned: number;
  generation?: number;
};

export type LabJobStatus = "running" | "idle";

export type ActiveLabJob = {
  id: string;
  type: LabJobType;
  startedAt: number;
  updatedAt: number;
  status: LabJobStatus;
  label: string;
  progress: LabJobGridProgress | LabJobOptimizationProgress;
  /** `sessionStorage` id for the tab that started the job (survives reload in the same tab). */
  ownerTabId: string;
  payload?: Record<string, unknown>;
};

export type LabJobStoreSnapshot = {
  activeJob: ActiveLabJob | null;
};

type LabJobListener = () => void;

const listeners = new Set<LabJobListener>();

let broadcastChannel: BroadcastChannel | null | undefined;

function getBroadcastChannel(): BroadcastChannel | null {
  if (broadcastChannel !== undefined) return broadcastChannel;
  if (typeof BroadcastChannel === "undefined") {
    broadcastChannel = null;
    return broadcastChannel;
  }
  try {
    broadcastChannel = new BroadcastChannel(LAB_JOB_BROADCAST_CHANNEL);
  } catch {
    broadcastChannel = null;
  }
  return broadcastChannel;
}

function emitLabJobListeners(): void {
  for (const l of listeners) l();
}

function postBroadcast(): void {
  try {
    getBroadcastChannel()?.postMessage({ kind: "lab-job-update" });
  } catch {
    /* ignore */
  }
}

/** Stable per-tab id (new browser tab ⇒ new id; reload in same tab keeps id). */
export function getLabTabId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = sessionStorage.getItem(TAB_SESSION_KEY);
    if (!id) {
      id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(TAB_SESSION_KEY, id);
    }
    return id;
  } catch {
    return `fallback_${Date.now()}`;
  }
}

export function newLabJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseSnapshot(raw: string | null): LabJobStoreSnapshot {
  if (!raw) return { activeJob: null };
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object") return { activeJob: null };
    const activeJob = (v as LabJobStoreSnapshot).activeJob;
    if (activeJob == null) return { activeJob: null };
    if (typeof activeJob !== "object") return { activeJob: null };
    const j = activeJob as ActiveLabJob;
    if ((j.type !== "grid" && j.type !== "optimization") || (j.status !== "running" && j.status !== "idle"))
      return { activeJob: null };
    if (typeof j.id !== "string" || typeof j.ownerTabId !== "string") return { activeJob: null };
    return { activeJob: j };
  } catch {
    return { activeJob: null };
  }
}

export function readLabJobStore(): LabJobStoreSnapshot {
  if (typeof window === "undefined") return { activeJob: null };
  return parseSnapshot(localStorage.getItem(LAB_JOB_STORAGE_KEY));
}

export function readActiveLabJob(): ActiveLabJob | null {
  return readLabJobStore().activeJob;
}

export function writeLabJobSnapshot(snapshot: LabJobStoreSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    if (snapshot.activeJob == null) localStorage.removeItem(LAB_JOB_STORAGE_KEY);
    else localStorage.setItem(LAB_JOB_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
  postBroadcast();
  emitLabJobListeners();
}

export function setActiveLabJob(job: ActiveLabJob | null): void {
  writeLabJobSnapshot({ activeJob: job });
}

export function patchActiveLabJob(jobId: string, patch: Partial<Omit<ActiveLabJob, "id" | "updatedAt">>): void {
  const cur = readActiveLabJob();
  if (!cur || cur.id !== jobId) return;
  writeLabJobSnapshot({
    activeJob: { ...cur, ...patch, id: jobId, updatedAt: Date.now() },
  });
}

/** Remove stored job only if it still matches `jobId` (avoids clobbering a newer run). */
export function clearActiveLabJobIfId(jobId: string): void {
  const cur = readActiveLabJob();
  if (cur?.id === jobId) setActiveLabJob(null);
}

export function clearActiveLabJob(): void {
  setActiveLabJob(null);
}

/**
 * Subscribe to cross-tab and same-tab job store updates.
 * @returns unsubscribe
 */
export function subscribeLabJobs(cb: LabJobListener): () => void {
  listeners.add(cb);

  const onStorage = (e: StorageEvent) => {
    if (e.storageArea !== localStorage) return;
    if (e.key !== LAB_JOB_STORAGE_KEY && e.key != null) return;
    cb();
  };
  window.addEventListener("storage", onStorage);

  const ch = getBroadcastChannel();
  const onMessage = () => cb();
  ch?.addEventListener("message", onMessage);

  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    ch?.removeEventListener("message", onMessage);
  };
}

export function isGridProgress(p: ActiveLabJob["progress"]): p is LabJobGridProgress {
  return "done" in p && "total" in p;
}

export function isOptimizationProgress(p: ActiveLabJob["progress"]): p is LabJobOptimizationProgress {
  return "evaluations" in p && "planned" in p;
}
