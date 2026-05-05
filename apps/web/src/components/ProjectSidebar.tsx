"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AnalysisArtifact, AnalysisBatch, AnalysisFolder, AnalysisProject } from "@/lib/analysisTypes";
import { formatProjectOptionLabel } from "@/lib/projectSelectOptions";

const SIDEBAR_COLLAPSED_KEY = "ip-lab-sidebar-collapsed";

function readCollapsedFromStorage(): boolean | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return null;
}

function folderDepth(folders: AnalysisFolder[], id: string): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let d = 0;
  let cur: AnalysisFolder | undefined = byId.get(id);
  const guard = new Set<string>();
  while (cur?.parentId && !guard.has(cur.id)) {
    guard.add(cur.id);
    d++;
    cur = byId.get(cur.parentId);
  }
  return d;
}

function sortFolders(folders: AnalysisFolder[]): AnalysisFolder[] {
  return [...folders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ProjectSidebar(props: {
  projects: AnalysisProject[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onCreateProject: (name: string) => void;
  activeFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  autogenSubfolders: boolean;
  onAutogenChange: (v: boolean) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onLoadSingleBatch: (batch: AnalysisBatch) => void | Promise<void>;
  loadingSingleBatchId?: string | null;
  /** Merged onto the outer layout wrapper (width rail / overlay). */
  className?: string;
}) {
  const [newProjectName, setNewProjectName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [labSessionsPreview, setLabSessionsPreview] = useState<
    { id: string; sessionType: string; status: string; updatedAt: string }[]
  >([]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const syncMq = () => setIsMobile(mq.matches);
    syncMq();
    mq.addEventListener("change", syncMq);
    const stored = readCollapsedFromStorage();
    const mobile = mq.matches;
    setCollapsed(stored ?? mobile);
    setStorageReady(true);
    return () => mq.removeEventListener("change", syncMq);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed, storageReady]);

  useEffect(() => {
    const clearOverlay = (_event: Event) => {
      setCollapsed((prev) => (isMobile && !prev ? true : prev));
    };
    window.addEventListener("ip-lab:clear-stale-overlay", clearOverlay);
    return () => {
      window.removeEventListener("ip-lab:clear-stale-overlay", clearOverlay);
    };
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/lab/sessions");
        const j = (await res.json()) as {
          sessions?: { id: string; sessionType: string; status: string; updatedAt: string }[];
        };
        if (!cancelled && res.ok && j.sessions) {
          setLabSessionsPreview(j.sessions.slice(0, 5));
        }
      } catch {
        /* offline / no API */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const overlayOpen = isMobile && !collapsed;

  const project = useMemo(
    () => props.projects.find((p) => p.id === props.selectedProjectId),
    [props.projects, props.selectedProjectId],
  );

  const foldersSorted = useMemo(() => (project ? sortFolders(project.folders) : []), [project]);

  const batchesByFolder = useMemo(() => {
    if (!project) return new Map<string | null, AnalysisBatch[]>();
    const m = new Map<string | null, AnalysisBatch[]>();
    for (const b of project.batches) {
      const k = b.folderId ?? null;
      const arr = m.get(k) ?? [];
      arr.push(b);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return m;
  }, [project]);

  const artifactsByFolder = useMemo(() => {
    if (!project) return new Map<string | null, AnalysisArtifact[]>();
    const m = new Map<string | null, AnalysisArtifact[]>();
    for (const a of project.artifacts) {
      const k = a.folderId ?? null;
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return m;
  }, [project]);

  const kindLabel = (k: AnalysisBatch["kind"]) => {
    if (k === "single") return "●";
    if (k === "optimization") return "◇";
    return "▦";
  };

  const batchStatusTone = (status: AnalysisBatch["status"]) => {
    if (status === "running") return "text-amber-200";
    if (status === "failed") return "text-red-300";
    if (status === "cancelled") return "text-zinc-400";
    return "text-emerald-300";
  };

  const railClass =
    "flex min-h-0 max-h-[100dvh] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-[0_1px_0_rgba(0,0,0,0.35)] md:shadow-sm";

  const asideInner = (
    <>
      {collapsed ? (
        <div className="flex shrink-0 flex-col items-center gap-2 border-b border-[var(--border)]/80 bg-[var(--panel)] px-1 py-3">
          <span className="text-lg leading-none" title="Project & folders">
            📁
          </span>
          <button
            type="button"
            title="Expand project sidebar"
            aria-expanded={false}
            aria-controls="project-sidebar-panel"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[#0d0d0f] text-[var(--text)] hover:bg-[#1a1a1f]"
            onClick={() => setCollapsed(false)}
          >
            <span className="sr-only">Expand sidebar</span>
            <span aria-hidden className="text-sm leading-none">
              ›
            </span>
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)]/80 bg-[var(--panel)] px-3 py-2.5">
          <div className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Project
          </div>
          <button
            type="button"
            title="Collapse project sidebar"
            aria-expanded
            aria-controls="project-sidebar-panel"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[#0d0d0f] text-[var(--text)] hover:bg-[#1a1a1f]"
            onClick={() => setCollapsed(true)}
          >
            <span className="sr-only">Collapse sidebar</span>
            <span aria-hidden className="text-sm leading-none">
              ‹
            </span>
          </button>
        </div>
      )}

      <div
        id="project-sidebar-panel"
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 pb-3 pt-3 ${collapsed ? "hidden" : ""}`}
      >
      <div className="flex flex-col gap-2">
        <select
          aria-label="Active project"
          className="w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-xs"
          value={props.selectedProjectId ?? ""}
          onChange={(e) => props.onSelectProject(e.target.value)}
        >
          {props.projects.length === 0 ? <option value="">No projects yet</option> : null}
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {formatProjectOptionLabel(p)}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-[11px]"
            placeholder="New project…"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[11px] hover:bg-[#1a1a1f]"
            onClick={() => {
              const n = newProjectName.trim();
              if (!n) return;
              props.onCreateProject(n);
              setNewProjectName("");
            }}
          >
            +
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-[11px] leading-snug text-[var(--muted)]">
        <input
          type="checkbox"
          checked={props.autogenSubfolders}
          onChange={(e) => props.onAutogenChange(e.target.checked)}
          className="rounded border-[var(--border)]"
        />
        Autogen dated subfolder on save
      </label>

      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Folders &amp; runs</div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden pr-1 text-[11px]">
        <button
          type="button"
          onClick={() => props.onSelectFolder(null)}
          className={`flex w-full rounded px-1.5 py-0.5 text-left hover:bg-[#1a1a1f] ${
            props.activeFolderId == null ? "bg-[#1f1f26]" : ""
          }`}
        >
          📁 <span className="ml-1">Project root</span>
        </button>

        {foldersSorted.map((f) => {
          const depth = folderDepth(project?.folders ?? [], f.id);
          const pad = 8 + depth * 10;
          const isActive = props.activeFolderId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              style={{ paddingLeft: pad }}
              onClick={() => props.onSelectFolder(f.id)}
              className={`flex w-full rounded py-0.5 pr-1.5 text-left hover:bg-[#1a1a1f] ${
                isActive ? "bg-[#1f1f26]" : ""
              }`}
            >
              📂 {f.name}
            </button>
          );
        })}

        <div className="mt-1 flex gap-1 border-t border-[var(--border)] pt-1">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[#0d0d0f] px-1.5 py-0.5 text-[10px]"
            placeholder="New folder in selection…"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
          />
          <button
            type="button"
            className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] hover:bg-[#1a1a1f]"
            onClick={() => {
              const n = newFolderName.trim();
              if (!n || !project) return;
              props.onCreateFolder(props.activeFolderId, n);
              setNewFolderName("");
            }}
          >
            Add
          </button>
        </div>

        {!project ? (
          <p className="mt-2 text-[10px] text-[var(--muted)]">Create a project to store runs.</p>
        ) : (
          <>
            <div className="mt-2 text-[10px] text-[var(--muted)]">In {props.activeFolderId ? "folder" : "root"}</div>
            {(batchesByFolder.get(props.activeFolderId ?? null) ?? []).map((b) => (
              <div key={b.id} className="flex flex-col gap-0.5 rounded border border-transparent px-1 py-0.5 hover:border-[var(--border)]">
                <button
                  type="button"
                  className="w-full text-left font-mono-n text-[10px] text-[var(--text)]"
                  title={b.name}
                  onClick={() => {
                    if (b.kind === "single") void props.onLoadSingleBatch(b);
                  }}
                >
                  <span className="mr-1 opacity-70">{kindLabel(b.kind)}</span>
                  {b.name}
                  <span className={`ml-1.5 text-[9px] uppercase tracking-wide ${batchStatusTone(b.status)}`}>
                    {b.status}
                  </span>
                  {props.loadingSingleBatchId === b.id ? (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wide text-sky-200">loading</span>
                  ) : null}
                </button>
                <Link
                  href={`/analysis?project=${encodeURIComponent(project.id)}&batch=${encodeURIComponent(b.id)}`}
                  className="text-[9px] text-[var(--accent)] hover:underline"
                >
                  Open in analytics chat →
                </Link>
              </div>
            ))}
            {(artifactsByFolder.get(props.activeFolderId ?? null) ?? []).length > 0 ? (
              <div className="mt-2 text-[10px] text-[var(--muted)]">Agent files</div>
            ) : null}
            {(artifactsByFolder.get(props.activeFolderId ?? null) ?? []).map((a) => (
              <details key={a.id} className="rounded border border-[var(--border)] bg-[#0a0a0c] px-1 py-0.5">
                <summary className="cursor-pointer text-[10px]">{a.name}</summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[9px] text-[var(--muted)]">
                  {a.content}
                </pre>
              </details>
            ))}
          </>
        )}
      </div>

      <Link
        href={project ? `/analysis?project=${encodeURIComponent(project.id)}` : "/analysis"}
        className="mt-auto block shrink-0 rounded border border-[var(--border)] px-2 py-2 text-center text-[11px] hover:bg-[#1a1a1f]"
      >
        Project analytics chat →
      </Link>

      {/* Future lab navigation slot */}
      <footer className="shrink-0 border-t border-[var(--border)]/70 pt-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">Server lab sessions</div>
        <p className="mt-1 text-[9px] leading-snug text-[var(--muted)]">
          Auto-saved grid/optimize runs (SQLite). Open the <span className="text-[var(--text)]">Queue</span> tab for the
          full list and sim jobs.
        </p>
        {labSessionsPreview.length === 0 ? (
          <p className="mt-1 text-[9px] text-[var(--muted)]">No sessions yet.</p>
        ) : (
          <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto font-mono-n text-[9px] text-[var(--text)]">
            {labSessionsPreview.map((s) => (
              <li key={s.id} className="truncate" title={s.id}>
                <span className="text-[var(--muted)]">{s.sessionType === "optimization" ? "◇" : "▦"}</span>{" "}
                {s.id.slice(0, 8)}… · {s.status}
              </li>
            ))}
          </ul>
        )}
      </footer>
      </div>
    </>
  );

  const widthShellClass = collapsed
    ? "w-[52px] min-w-[52px] max-w-[52px]"
    : isMobile
      ? "w-0 min-w-0 overflow-visible"
      : "w-[260px] min-w-[260px] max-w-[260px]";

  return (
    <div
      className={`relative shrink-0 self-stretch transition-[width] duration-200 ease-out ${widthShellClass} ${props.className ?? ""}`}
    >
      {overlayOpen ? (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 bg-black/45 md:hidden" />
      ) : null}
      <aside
        className={`${railClass} sticky top-0 self-start max-h-[100dvh] ${
          overlayOpen ? "fixed left-0 top-0 z-50 w-[min(260px,100vw-2rem)] shadow-2xl md:relative md:left-auto md:top-auto md:z-auto md:w-full md:shadow-sm" : "w-full"
        }`}
      >
        {asideInner}
      </aside>
    </div>
  );
}
