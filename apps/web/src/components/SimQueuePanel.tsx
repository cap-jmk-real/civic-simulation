"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LabSessionQueueSummary } from "@/lib/simQueue/labSessionsQueueUi";
import { formatSimJobDebugPayload } from "@/lib/simQueue/jobDebugPayload";
import { formatLabSessionDebugPayload } from "@/lib/simQueue/labSessionDebugPayload";
import { parseQueueLabStreamPayload } from "@/lib/simQueue/parseStreamEvent";
import {
  parseSimJobDetailResponse,
  parseSimJobsListResponse,
  type SimJobDetailDto,
  type SimJobSummaryDto,
} from "@/lib/simQueue/parseJobsResponse";
import { queuePollingIntervalMs } from "@/lib/simQueue/pollingCadence";
import { deriveWorkerHealthState, formatAgeShort } from "@/lib/simQueue/workerHealth";

type LabSessionSummary = LabSessionQueueSummary & {
  createdAt?: string;
  bestTrialId?: string | null;
  heartbeatAt?: string | null;
  statusNote?: string | null;
  meta?: unknown;
};

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function isCancellableStatus(status: string | undefined): boolean {
  return status === "queued" || status === "running";
}

function statusTone(status: string): string {
  if (status === "running") return "text-amber-200";
  if (status === "interrupted") return "text-orange-300";
  if (status === "failed") return "text-red-300";
  if (status === "cancelled") return "text-zinc-400";
  return "text-emerald-300";
}

function deriveJobNote(job: SimJobSummaryDto): string {
  if (job.status === "queued" || job.status === "running") {
    return job.progress_note ?? job.status_note ?? job.error_text ?? "—";
  }
  return job.status_note ?? job.error_text ?? job.progress_note ?? "—";
}

export function SimQueuePanel() {
  const [jobs, setJobs] = useState<SimJobSummaryDto[]>([]);
  const [labSessions, setLabSessions] = useState<LabSessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SimJobDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelingIds, setCancelingIds] = useState<Record<string, true>>({});
  const [cancelingSessionIds, setCancelingSessionIds] = useState<Record<string, true>>({});
  const [copyStatusByJobId, setCopyStatusByJobId] = useState<Record<string, "copied" | "failed">>({});
  const [copyStatusBySessionId, setCopyStatusBySessionId] = useState<Record<string, "copied" | "failed">>({});
  const hasActiveRunsRef = useRef(false);
  const workerHealth = deriveWorkerHealthState(jobs, labSessions);

  useEffect(() => {
    hasActiveRunsRef.current =
      jobs.some((job) => isCancellableStatus(job.status)) || labSessions.some((session) => isCancellableStatus(session.status));
  }, [jobs, labSessions]);

  const refresh = useCallback(async () => {
    try {
      const [jobRes, labRes] = await Promise.all([
        fetch("/api/sim/jobs", { cache: "no-store" }),
        fetch("/api/lab/sessions", { cache: "no-store" }),
      ]);
      const jj = parseSimJobsListResponse(await jobRes.json());
      if (!jobRes.ok) throw new Error(jj.error ?? jobRes.statusText);
      setJobs(jj.jobs);
      const lj = (await labRes.json()) as { sessions?: LabSessionSummary[]; error?: string };
      if (labRes.ok) setLabSessions(lj.sessions ?? []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let stopped = false;
    let sseConnected = false;
    let timer: number | null = null;
    const schedulePoll = () => {
      if (stopped) return;
      const tabVisible = typeof document === "undefined" ? true : document.visibilityState === "visible";
      const delay = queuePollingIntervalMs({ sseConnected, hasActiveRuns: hasActiveRunsRef.current, tabVisible });
      timer = window.setTimeout(async () => {
        await refresh();
        schedulePoll();
      }, delay);
    };
    const es = new EventSource("/api/sim/stream");
    es.onopen = () => {
      sseConnected = true;
    };
    es.onerror = () => {
      sseConnected = false;
    };
    es.onmessage = (ev) => {
      let top: Record<string, unknown>;
      try {
        top = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof top.error === "string") {
        setLoadError(top.error);
        return;
      }
      const r = parseQueueLabStreamPayload(ev.data);
      if (r.ok) {
        setJobs(r.data.jobs);
        setLabSessions(r.data.sessions);
        setLoadError(null);
      }
    };
    schedulePoll();
    return () => {
      stopped = true;
      es.close();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!detailId) return;
    const url = `/api/sim/jobs/${encodeURIComponent(detailId)}/stream`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let o: unknown;
      try {
        o = JSON.parse(ev.data) as unknown;
      } catch {
        return;
      }
      if (o != null && typeof o === "object" && "error" in o && typeof (o as { error: unknown }).error === "string") {
        setActionError((o as { error: string }).error);
        return;
      }
      const parsed = parseSimJobDetailResponse(o);
      if (parsed.error) {
        setActionError(parsed.error);
        return;
      }
      if (parsed.detail) {
        setDetail((prev) => {
          if (prev != null && prev.id !== detailId) return prev;
          return parsed.detail!;
        });
        setActionError(null);
      }
    };
    return () => es.close();
  }, [detailId]);

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/sim/jobs/${id}`, { cache: "no-store" });
      const parsed = parseSimJobDetailResponse(await res.json());
      if (!res.ok || parsed.error || !parsed.detail) throw new Error(parsed.error ?? res.statusText);
      setDetail(parsed.detail);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };

  const cancelJob = async (id: string) => {
    setCancelingIds((prev) => ({ ...prev, [id]: true }));
    setActionError(null);
    setJobs((prev) =>
      prev.map((job) =>
        job.id === id && isCancellableStatus(job.status)
          ? { ...job, status: "cancelled", progress_note: "cancelling…" }
          : job,
      ),
    );
    setDetail((prev) =>
      prev && prev.id === id && isCancellableStatus(prev.status)
        ? { ...prev, status: "cancelled", progress_note: "cancelling…" }
        : prev,
    );
    try {
      const res = await fetch(`/api/sim/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const j = (await res.json()) as { error?: string; cancelled?: boolean };
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      await refresh();
      if (detailId === id) void openDetail(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      await refresh();
      if (detailId === id) void openDetail(id);
    } finally {
      setCancelingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const cancelLabSession = async (id: string) => {
    setCancelingSessionIds((prev) => ({ ...prev, [id]: true }));
    setActionError(null);
    setLabSessions((prev) =>
      prev.map((s) =>
        s.id === id && isCancellableStatus(s.status) ? { ...s, status: "cancelled" } : s,
      ),
    );
    try {
      const res = await fetch(`/api/lab/sessions/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const j = (await res.json()) as { error?: string; cancelled?: boolean };
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setCancelingSessionIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const clearCopyStatusSoon = useCallback((id: string) => {
    window.setTimeout(() => {
      setCopyStatusByJobId((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 1800);
  }, []);

  const clearSessionCopyStatusSoon = useCallback((id: string) => {
    window.setTimeout(() => {
      setCopyStatusBySessionId((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 1800);
  }, []);

  const fetchDetailForCopy = useCallback(
    async (id: string): Promise<SimJobDetailDto | null> => {
      if (detail?.id === id) return detail;
      const res = await fetch(`/api/sim/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
      const parsed = parseSimJobDetailResponse(await res.json());
      if (!res.ok || parsed.error || !parsed.detail) {
        throw new Error(parsed.error ?? res.statusText);
      }
      return parsed.detail;
    },
    [detail],
  );

  const copyDebugPayload = useCallback(
    async (job: SimJobSummaryDto) => {
      try {
        const jobDetail = await fetchDetailForCopy(job.id);
        const payload = formatSimJobDebugPayload({ summary: job, detail: jobDetail });
        await navigator.clipboard.writeText(payload);
        setCopyStatusByJobId((prev) => ({ ...prev, [job.id]: "copied" }));
      } catch (e) {
        setCopyStatusByJobId((prev) => ({ ...prev, [job.id]: "failed" }));
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        clearCopyStatusSoon(job.id);
      }
    },
    [clearCopyStatusSoon, fetchDetailForCopy],
  );

  type LabSessionDetailDto = {
    id: string;
    sessionType: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    projectId: string | null;
    bestTrialId: string | null;
    trialCount: number;
    cellCount: number;
    meta: unknown;
  };

  function parseLabSessionDetailResponse(value: unknown): { session: LabSessionDetailDto | null; error: string | null } {
    if (value == null || typeof value !== "object") return { session: null, error: "Invalid lab session response" };
    const root = value as Record<string, unknown>;
    if (typeof root.error === "string") return { session: null, error: root.error };
    const raw = root.session;
    if (raw == null || typeof raw !== "object") return { session: null, error: "Missing lab session payload" };
    const s = raw as Record<string, unknown>;
    if (
      typeof s.id !== "string" ||
      typeof s.sessionType !== "string" ||
      typeof s.status !== "string" ||
      typeof s.createdAt !== "string" ||
      typeof s.updatedAt !== "string" ||
      (s.projectId !== null && typeof s.projectId !== "string") ||
      (s.bestTrialId !== null && typeof s.bestTrialId !== "string") ||
      typeof s.trialCount !== "number" ||
      typeof s.cellCount !== "number"
    ) {
      return { session: null, error: "Malformed lab session payload" };
    }
    return {
      session: {
        id: s.id,
        sessionType: s.sessionType,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        projectId: s.projectId,
        bestTrialId: s.bestTrialId,
        trialCount: s.trialCount,
        cellCount: s.cellCount,
        meta: s.meta,
      },
      error: null,
    };
  }

  const fetchLabSessionForCopy = useCallback(async (id: string): Promise<LabSessionDetailDto> => {
    const res = await fetch(`/api/lab/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
    const parsed = parseLabSessionDetailResponse(await res.json());
    if (!res.ok || parsed.error || !parsed.session) throw new Error(parsed.error ?? res.statusText);
    return parsed.session;
  }, []);

  const copyLabSessionDebugPayload = useCallback(
    async (session: LabSessionSummary) => {
      try {
        const detail = await fetchLabSessionForCopy(session.id);
        const payload = formatLabSessionDebugPayload({ summary: session, detail });
        await navigator.clipboard.writeText(payload);
        setCopyStatusBySessionId((prev) => ({ ...prev, [session.id]: "copied" }));
      } catch (e) {
        setCopyStatusBySessionId((prev) => ({ ...prev, [session.id]: "failed" }));
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        clearSessionCopyStatusSoon(session.id);
      }
    },
    [clearSessionCopyStatusSoon, fetchLabSessionForCopy],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Simulation job queue</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs hover:bg-[#1a1a1f]"
        >
          Refresh
        </button>
      </div>
      <p className="text-[10px] text-[var(--muted)]">
        Jobs are stored in SQLite (<code className="font-mono-n">SIM_QUEUE_DB_PATH</code> or{" "}
        <code className="font-mono-n">data/sim-queue.db</code>). Start the worker with{" "}
        <code className="font-mono-n">pnpm dev:all</code> (recommended) or <code className="font-mono-n">pnpm sim:worker</code>{" "}
        so queued runs execute (TypeScript heuristic / QRE in Node — not browser WASM). Grid and optimization
        auto-sessions use the same DB (
        <code className="font-mono-n">lab_*</code> tables); large payloads under{" "}
        <code className="font-mono-n">data/lab-exports/</code>. The panel subscribes to{" "}
        <code className="font-mono-n">GET /api/sim/stream</code> (SSE, server polls DB ~600ms) so worker progress
        appears without waiting for a slow client poll; POST enqueue returns{" "}
        <code className="font-mono-n">streamUrl</code> / <code className="font-mono-n">jobStreamUrl</code> for the same
        endpoints.
      </p>
      {loadError ? (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 p-2 text-xs text-amber-100">{loadError}</p>
      ) : null}
      {actionError ? (
        <p className="rounded border border-red-900/60 bg-red-950/40 p-2 text-xs text-red-200">{actionError}</p>
      ) : null}
      {workerHealth.workerLikelyDown ? (
        <p className="rounded border border-amber-900/60 bg-amber-950/40 p-2 text-xs text-amber-100">
          Worker appears offline: {workerHealth.queuedJobs} queued job{workerHealth.queuedJobs === 1 ? "" : "s"} with
          no active claims for ~{formatAgeShort(workerHealth.oldestQueuedAgeMs ?? 0)}. Run{" "}
          <code className="font-mono-n">pnpm dev:all</code> (or <code className="font-mono-n">pnpm sim:worker</code>) to
          process queue jobs.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[32rem] border-collapse text-left text-[11px]">
          <thead className="bg-[#141418] text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Id</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Status</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Policy</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Created</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Note</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-[var(--muted)]">
                  No jobs yet — enqueue a single run from the Single tab.
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id} className="border-b border-[var(--border)]/60 hover:bg-[#0f0f12]">
                  <td className="px-2 py-1.5 font-mono-n text-[10px]" title={job.id}>
                    {shortId(job.id)}
                  </td>
                  <td className={`px-2 py-1.5 font-medium ${statusTone(job.status)}`}>{job.status}</td>
                  <td className="px-2 py-1.5">{job.policyMode}</td>
                  <td className="px-2 py-1.5 font-mono-n text-[10px] text-[var(--muted)]">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5 text-[var(--muted)]" title={deriveJobNote(job)}>
                    {deriveJobNote(job)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-white hover:bg-zinc-600"
                        onClick={() => void openDetail(job.id)}
                      >
                        Details
                      </button>
                      {isCancellableStatus(job.status) ? (
                        <button
                          type="button"
                          aria-label={`Cancel job ${shortId(job.id)}`}
                          aria-busy={Boolean(cancelingIds[job.id])}
                          className="rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-[#1a1a1f]"
                          onClick={() => void cancelJob(job.id)}
                          disabled={Boolean(cancelingIds[job.id])}
                        >
                          {cancelingIds[job.id] ? "Cancelling…" : "Cancel"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Copy debug payload for job ${shortId(job.id)}`}
                        className="rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-[#1a1a1f]"
                        onClick={() => void copyDebugPayload(job)}
                      >
                        Copy debug
                      </button>
                      {copyStatusByJobId[job.id] === "copied" ? (
                        <span className="px-1 text-[10px] text-emerald-300" role="status" aria-live="polite">
                          Copied
                        </span>
                      ) : null}
                      {copyStatusByJobId[job.id] === "failed" ? (
                        <span className="px-1 text-[10px] text-red-300" role="status" aria-live="polite">
                          Copy failed
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-medium">Recent lab sessions (auto-saved)</h2>
      <p className="text-[10px] text-[var(--muted)]">
        Parameter grid and optimization runs register here as they progress. Use{" "}
        <code className="font-mono-n">GET /api/lab/sessions/[id]/trials</code> or{" "}
        <code className="font-mono-n">…/cells</code> for details.
      </p>
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="w-full min-w-[28rem] border-collapse text-left text-[11px]">
          <thead className="bg-[#141418] text-[var(--muted)]">
            <tr>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Session</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Type</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Status</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Rows</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Updated</th>
              <th className="border-b border-[var(--border)] px-2 py-1.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {labSessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-4 text-center text-[var(--muted)]">
                  No lab sessions yet — run a grid or optimization from the other tabs.
                </td>
              </tr>
            ) : (
              labSessions.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)]/60 hover:bg-[#0f0f12]">
                  <td className="px-2 py-1.5 font-mono-n text-[10px]" title={s.id}>
                    {shortId(s.id)}
                  </td>
                  <td className="px-2 py-1.5">{s.sessionType}</td>
                  <td className={`px-2 py-1.5 font-medium ${statusTone(s.status)}`}>{s.status}</td>
                  <td className="px-2 py-1.5 tabular-nums text-[var(--muted)]">
                    {s.sessionType === "optimization" ? s.trialCount : s.cellCount}
                  </td>
                  <td className="px-2 py-1.5 font-mono-n text-[10px] text-[var(--muted)]">
                    {new Date(s.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {isCancellableStatus(s.status) ? (
                        <button
                          type="button"
                          aria-label={`Cancel lab session ${shortId(s.id)}`}
                          aria-busy={Boolean(cancelingSessionIds[s.id])}
                          className="rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-[#1a1a1f] disabled:opacity-60"
                          onClick={() => void cancelLabSession(s.id)}
                          disabled={Boolean(cancelingSessionIds[s.id])}
                        >
                          {cancelingSessionIds[s.id] ? "Cancelling…" : "Cancel"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Copy debug payload for lab session ${shortId(s.id)}`}
                        className="rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] hover:bg-[#1a1a1f]"
                        onClick={() => void copyLabSessionDebugPayload(s)}
                      >
                        Copy debug
                      </button>
                      {copyStatusBySessionId[s.id] === "copied" ? (
                        <span className="px-1 text-[10px] text-emerald-300" role="status" aria-live="polite">
                          Copied
                        </span>
                      ) : null}
                      {copyStatusBySessionId[s.id] === "failed" ? (
                        <span className="px-1 text-[10px] text-red-300" role="status" aria-live="polite">
                          Copy failed
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailId ? (
        <section className="space-y-2 rounded-lg border border-[var(--border)] border-dashed bg-[#0a0a0c] p-3">
          <h3 className="text-xs font-medium text-[var(--muted)]">Job {shortId(detailId)}</h3>
          {detailLoading ? <p className="text-xs text-[var(--muted)]">Loading…</p> : null}
          {!detailLoading && detail ? (
            <div className="space-y-2 text-[10px]">
              <p>
                <span className="text-[var(--muted)]">Status:</span> {detail.status}
              </p>
              {detail && isCancellableStatus(detail.status) ? (
                <div>
                  <button
                    type="button"
                    aria-label={`Cancel job ${shortId(detail.id)}`}
                    aria-busy={Boolean(cancelingIds[detail.id])}
                    className="rounded border border-zinc-600 px-2 py-1 text-[10px] hover:bg-[#1a1a1f] disabled:opacity-60"
                    onClick={() => void cancelJob(detail.id)}
                    disabled={Boolean(cancelingIds[detail.id])}
                  >
                    {cancelingIds[detail.id] ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              ) : null}
              <div>
                <button
                  type="button"
                  aria-label={`Copy debug payload for job ${shortId(detail.id)}`}
                  className="rounded border border-zinc-600 px-2 py-1 text-[10px] hover:bg-[#1a1a1f]"
                  onClick={() => {
                    const summary =
                      jobs.find((job) => job.id === detail.id) ??
                      ({
                        id: detail.id,
                        status: detail.status,
                        created_at: detail.created_at,
                        updated_at: detail.updated_at,
                        policyMode: "unknown",
                        progress_note: detail.progress_note,
                        status_note: detail.status_note,
                        error_text: detail.error_text,
                        hasResult: Boolean(detail.result_json),
                      } satisfies SimJobSummaryDto);
                    void copyDebugPayload(summary);
                  }}
                >
                  Copy debug payload
                </button>
              </div>
              {detail.progress_note ? (
                <p>
                  <span className="text-[var(--muted)]">Progress:</span> {detail.progress_note}
                </p>
              ) : null}
              {detail.error_text ? (
                <p className="text-red-200">
                  <span className="text-[var(--muted)]">Error:</span> {detail.error_text}
                </p>
              ) : null}
              {detail.payload != null ? (
                <details>
                  <summary className="cursor-pointer text-[var(--muted)]">Payload (config excerpt)</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-[#050506] p-2 font-mono-n text-[9px]">
                    {JSON.stringify(detail.payload, null, 2).slice(0, 8000)}
                    {JSON.stringify(detail.payload, null, 2).length > 8000 ? "\n…" : ""}
                  </pre>
                </details>
              ) : null}
              {detail.result_json ? (
                <details open>
                  <summary className="cursor-pointer text-[var(--muted)]">Result JSON</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-[#050506] p-2 font-mono-n text-[9px]">
                    {detail.result_json.length > 120_000
                      ? `${detail.result_json.slice(0, 120_000)}\n… (truncated in UI)`
                      : detail.result_json}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
