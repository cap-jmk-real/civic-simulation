"use client";

import type { GridAxisAssignment } from "@/lib/gridAxes";
import type { GridCellResult } from "@/lib/gridBatchTypes";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import {
  analysisStoreSchema,
  type AnalysisBatch,
  type AnalysisProject,
  type AnalysisStore,
  type StoredCell,
} from "@/lib/analysisTypes";

const STORAGE_KEY = "ip-abm-analysis-store-v1";

function newId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadStore(): AnalysisStore {
  if (typeof window === "undefined") {
    return { version: 1, projects: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, projects: [] };
    const parsed: unknown = JSON.parse(raw);
    const r = analysisStoreSchema.safeParse(parsed);
    if (!r.success) {
      console.warn("analysisStorage: invalid store, resetting", r.error.flatten());
      return { version: 1, projects: [] };
    }
    return r.data;
  } catch {
    return { version: 1, projects: [] };
  }
}

function saveStore(store: AnalysisStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listProjects(): AnalysisProject[] {
  return loadStore().projects;
}

export function upsertProject(project: AnalysisProject): void {
  const s = loadStore();
  const i = s.projects.findIndex((p) => p.id === project.id);
  if (i >= 0) s.projects[i] = project;
  else s.projects.push(project);
  saveStore(s);
}

export function deleteProject(id: string): void {
  const s = loadStore();
  s.projects = s.projects.filter((p) => p.id !== id);
  saveStore(s);
}

export function addBatchToProject(projectId: string, batch: AnalysisBatch): void {
  const s = loadStore();
  const p = s.projects.find((x) => x.id === projectId);
  if (!p) return;
  p.batches = [...p.batches.filter((b) => b.id !== batch.id), batch];
  p.updatedAt = new Date().toISOString();
  saveStore(s);
}

export function createProject(name: string): AnalysisProject {
  const now = new Date().toISOString();
  const p: AnalysisProject = {
    id: newId(),
    name: name.trim() || "Untitled project",
    createdAt: now,
    updatedAt: now,
    batches: [],
  };
  upsertProject(p);
  return p;
}

/** Convert live grid results to a storable batch (no full `history` arrays). */
export function gridResultsToBatch(
  name: string,
  results: GridCellResult[],
  constructionMode: string,
  levelProductLabel: string,
): AnalysisBatch {
  const now = new Date().toISOString();
  const cells: StoredCell[] = results.map((r) => {
    const last = r.run.history[r.run.history.length - 1];
    const m = last?.metrics;
    const tickCount = r.run.history.length;
    return {
      id: r.id,
      label: r.label,
      assignments: r.assignments.map((a: GridAxisAssignment) => ({ id: a.id, value: a.value })),
      simSeed: r.run.manifest.seed,
      simTicks: tickCount,
      metrics: {
        tick: m?.tick ?? 0,
        tickCount,
        giniWealth: m?.giniWealth,
        meanWealth: last ? meanWealthAtTick(last) : undefined,
        totalWealth: m?.totalWealth,
        innovationFlow: last ? innovationFlowAtTick(last) : undefined,
        innovationFlowPerAgent: last ? innovationFlowPerAgentAtTick(last) : undefined,
        top10WealthShare: m?.top10WealthShare,
      },
    };
  });
  return {
    id: newId(),
    name: name.trim() || `Batch ${now.slice(0, 19)}`,
    createdAt: now,
    constructionMode,
    levelProductLabel,
    cells,
  };
}

export function buildContextForAgent(project: AnalysisProject, batchId: string): string {
  const batch = project.batches.find((b) => b.id === batchId);
  if (!batch) return "";
  const lines: string[] = [
    `# Project: ${project.name}`,
    `Batch: ${batch.name} (${batch.createdAt})`,
    `Construction: ${batch.constructionMode} · levels → ${batch.levelProductLabel}`,
    `Cells: ${batch.cells.length}`,
    "",
  ];
  for (const c of batch.cells) {
    const ax = c.assignments.map((a) => `${a.id}=${a.value}`).join(", ");
    const met = c.metrics;
    lines.push(
      `## ${c.label}`,
      `- assignments: ${ax}`,
      `- seed: ${c.simSeed}, ticks: ${c.simTicks}`,
      `- final tick ${met.tick}: gini ${met.giniWealth?.toFixed(4) ?? "—"}, meanWealth ${met.meanWealth?.toFixed(4) ?? "—"}, innovationFlow ${met.innovationFlow?.toFixed(4) ?? "—"}, I/agent ${met.innovationFlowPerAgent?.toFixed(6) ?? "—"}, top10 share ${met.top10WealthShare?.toFixed(4) ?? "—"}`,
      "",
    );
  }
  return lines.join("\n");
}
