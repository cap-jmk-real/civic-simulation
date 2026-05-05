"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addBatchToProject,
  buildContextForAgent,
  createProject,
  deleteProject,
  listProjects,
  loadStore,
} from "@/lib/analysisStorage";
import type { AnalysisBatch, AnalysisProject } from "@/lib/analysisTypes";

export default function AnalysisPage() {
  const searchParams = useSearchParams();
  const [projects, setProjects] = useState<AnalysisProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setProjects(listProjects());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const pid = searchParams.get("project");
    const bid = searchParams.get("batch");
    if (!pid || projects.length === 0) return;
    const proj = projects.find((p) => p.id === pid);
    if (!proj) return;
    setSelectedProjectId(pid);
    if (bid && proj.batches.some((b) => b.id === bid)) {
      setSelectedBatchId(bid);
    }
  }, [searchParams, projects]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const selectedBatch = useMemo(() => {
    if (!selectedProject || !selectedBatchId) return undefined;
    return selectedProject.batches.find((b) => b.id === selectedBatchId);
  }, [selectedProject, selectedBatchId]);

  const context = useMemo(() => {
    if (!selectedProject || !selectedBatchId) return "";
    return buildContextForAgent(selectedProject, selectedBatchId);
  }, [selectedProject, selectedBatchId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !context || streaming) return;
    setInput("");
    setError(null);
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setStreaming(true);

    try {
      const res = await fetch("/api/analysis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          context,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");
      const dec = new TextDecoder();
      let acc = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", content: acc };
          }
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        const errText = `Could not complete analysis: ${msg}`;
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { role: "assistant", content: errText };
          return copy;
        }
        return [...m, { role: "assistant", content: errText }];
      });
    } finally {
      setStreaming(false);
    }
  };

  const createNewProject = () => {
    const p = createProject(newProjectName || "Analysis project");
    setNewProjectName("");
    refresh();
    setSelectedProjectId(p.id);
    setSelectedBatchId("");
    setMessages([]);
  };

  const removeProject = (id: string) => {
    deleteProject(id);
    refresh();
    if (selectedProjectId === id) {
      setSelectedProjectId("");
      setSelectedBatchId("");
    }
  };

  /** Import batch JSON from clipboard or merge store — used when returning from main lab with ?import=1 */
  const importBatchFromClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const parsed = JSON.parse(raw) as {
        projectName?: string;
        batch: AnalysisBatch;
        projectId?: string;
      };
      if (!parsed.batch?.cells) {
        setError("Clipboard JSON must include a batch with cells.");
        return;
      }
      let pid = parsed.projectId ?? selectedProjectId;
      if (!pid) {
        const p = createProject(parsed.projectName ?? "Imported");
        pid = p.id;
        setSelectedProjectId(pid);
      }
      const store = loadStore();
      const proj = store.projects.find((p) => p.id === pid);
      if (!proj) {
        setError("Project not found for import.");
        return;
      }
      addBatchToProject(pid, parsed.batch);
      refresh();
      setSelectedProjectId(pid);
      setSelectedBatchId(parsed.batch.id);
      setMessages([]);
      setError(null);
    } catch {
      setError("Clipboard does not contain valid batch JSON.");
    }
  };

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 lg:p-6">
      <header className="border-b border-[var(--border)] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Batch analytics</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Select a saved project and batch, then ask questions. Powered by the Cursor SDK on the server (
              <code className="text-[11px]">CURSOR_API_KEY</code>).
            </p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[#1a1a1f]"
          >
            ← Simulation lab
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          <div>
            <label className="text-xs font-medium text-[var(--muted)]">New project</label>
            <div className="mt-1 flex gap-1">
              <input
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1 text-sm"
                placeholder="Name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
              <button
                type="button"
                onClick={createNewProject}
                className="shrink-0 rounded bg-zinc-600 px-2 py-1 text-xs text-white hover:bg-zinc-500"
              >
                Create
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">Projects</label>
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-sm">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProjectId(p.id);
                      setSelectedBatchId("");
                      setMessages([]);
                    }}
                    className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left ${
                      selectedProjectId === p.id ? "bg-[#2a2a32]" : "hover:bg-[#1a1a1f]"
                    }`}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-red-300 hover:underline"
                    onClick={() => removeProject(p.id)}
                  >
                    del
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="text-xs font-medium text-[var(--muted)]">Batches in project</label>
            <select
              className="mt-1 w-full rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-sm"
              value={selectedBatchId}
              onChange={(e) => {
                setSelectedBatchId(e.target.value);
                setMessages([]);
              }}
              disabled={!selectedProject}
            >
              <option value="">— select batch —</option>
              {selectedProject?.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.cells.length} cells)
                </option>
              ))}
            </select>
          </div>

          <p className="text-[10px] leading-snug text-[var(--muted)]">
            Save batches from the simulation lab with &quot;Save batch to project&quot; after a grid run. Or paste
            JSON from the clipboard (Export batch JSON).
          </p>
          <button
            type="button"
            onClick={() => void importBatchFromClipboard()}
            className="w-full rounded border border-[var(--border)] py-1 text-[11px] hover:bg-[#1a1a1f]"
          >
            Import batch from clipboard
          </button>
        </aside>

        <section className="flex min-h-[420px] flex-col rounded-lg border border-[var(--border)] bg-[#0c0c10]">
          <div className="border-b border-[var(--border)] px-3 py-2">
            <h2 className="text-sm font-medium">Analysis chat</h2>
            {selectedBatch ? (
              <p className="mt-0.5 font-mono-n text-[10px] text-[var(--muted)]">
                {selectedBatch.name} · {selectedBatch.constructionMode} · {selectedBatch.cells.length} cells
              </p>
            ) : (
              <p className="mt-0.5 text-[10px] text-amber-100/90">Select a project and batch to enable chat.</p>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.length === 0 ? (
              <p className="text-[var(--muted)]">
                Example: &quot;Which parameter settings maximize innovation flow per agent?&quot; or &quot;Summarize
                tradeoffs visible across cells.&quot;
              </p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-md px-3 py-2 ${
                  m.role === "user" ? "ml-8 bg-zinc-800/80" : "mr-8 border border-[var(--border)] bg-[#12121a]"
                }`}
              >
                <div className="mb-1 text-[10px] font-medium uppercase text-[var(--muted)]">{m.role}</div>
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{m.content}</pre>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <p className="border-t border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</p>
          ) : null}

          <div className="flex gap-2 border-t border-[var(--border)] p-3">
            <textarea
              className="min-h-[72px] flex-1 resize-y rounded border border-[var(--border)] bg-[#0d0d0f] px-2 py-1.5 text-sm"
              placeholder={context ? "Ask about this batch…" : "Select a batch first…"}
              value={input}
              disabled={!context || streaming}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
            />
            <button
              type="button"
              disabled={!context || streaming || !input.trim()}
              onClick={() => void sendMessage()}
              className="self-end rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {streaming ? "…" : "Send"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
