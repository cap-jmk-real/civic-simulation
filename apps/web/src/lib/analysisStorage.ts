"use client";

import type { GridAxisAssignment } from "@/lib/gridAxes";
import type { GridCellResult } from "@/lib/gridBatchTypes";
import {
  innovationFlowAtTick,
  innovationFlowPerAgentAtTick,
  meanWealthAtTick,
} from "@/lib/runOutcomeMetrics";
import {
  migrateAnalysisStore,
  type AnalysisArtifact,
  type AnalysisBatch,
  type AnalysisBatchKind,
  type AnalysisFolder,
  type AnalysisProject,
  type AnalysisStore,
} from "@/lib/analysisTypes";
import type { SimulationRun, WorldState } from "@ip-sim/core";
import { parseRun } from "@ip-sim/core";

const STORAGE_KEY = "ip-abm-analysis-store-v1";

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadStore(): AnalysisStore {
  if (typeof window === "undefined") {
    return { version: 3, projects: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 3, projects: [] };
    const parsed: unknown = JSON.parse(raw);
    return migrateAnalysisStore(parsed);
  } catch {
    return { version: 3, projects: [] };
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
    id: newId("p"),
    name: name.trim() || "Untitled project",
    createdAt: now,
    updatedAt: now,
    folders: [],
    artifacts: [],
    batches: [],
  };
  upsertProject(p);
  return p;
}

export function createFolder(
  projectId: string,
  name: string,
  parentId: string | null = null,
): AnalysisFolder | null {
  const s = loadStore();
  const p = s.projects.find((x) => x.id === projectId);
  if (!p) return null;
  const folder: AnalysisFolder = {
    id: newId("fld"),
    name: name.trim() || "Folder",
    parentId,
    createdAt: new Date().toISOString(),
  };
  p.folders = [...p.folders, folder];
  p.updatedAt = new Date().toISOString();
  saveStore(s);
  return folder;
}

export function addArtifactToProject(projectId: string, artifact: AnalysisArtifact): void {
  const s = loadStore();
  const p = s.projects.find((x) => x.id === projectId);
  if (!p) return;
  p.artifacts = [...p.artifacts.filter((a) => a.id !== artifact.id), artifact];
  p.updatedAt = new Date().toISOString();
  saveStore(s);
}

/** Optional dated subfolder under `parentId` (or project root when null). */
export function ensureAutoSubfolder(
  projectId: string,
  parentId: string | null,
  tag: string,
): string | null {
  const label = `${tag} · ${new Date().toISOString().slice(0, 10)}`;
  return createFolder(projectId, label, parentId)?.id ?? null;
}

/** Convert live grid results to a storable batch (no full `history` arrays on cells). */
export function gridResultsToBatch(
  name: string,
  results: GridCellResult[],
  constructionMode: string,
  levelProductLabel: string,
  options?: {
    id?: string;
    kind?: AnalysisBatchKind;
    status?: AnalysisBatch["status"];
    runRef?: AnalysisBatch["runRef"];
    folderId?: string | null;
  },
): AnalysisBatch {
  const now = new Date().toISOString();
  const cells = results.map((r) => {
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
    id: options?.id ?? newId("b"),
    name: name.trim() || `Batch ${now.slice(0, 19)}`,
    createdAt: now,
    constructionMode,
    levelProductLabel,
    cells,
    kind: options?.kind ?? "grid",
    status: options?.status ?? "done",
    runRef: options?.runRef,
    folderId: options?.folderId ?? null,
  };
}

/** Persist full run including `finalWorld` so the lab graph preview can reload. */
export function singleRunToBatch(
  name: string,
  run: SimulationRun & { finalWorld?: WorldState },
  options?: {
    id?: string;
    status?: AnalysisBatch["status"];
    runRef?: AnalysisBatch["runRef"];
    folderId?: string | null;
  },
): AnalysisBatch {
  const now = new Date().toISOString();
  return {
    id: options?.id ?? newId("b"),
    name: name.trim() || `Run ${now.slice(0, 19)}`,
    createdAt: now,
    constructionMode: "single",
    levelProductLabel: `seed ${run.manifest.seed} · ${run.history.length} ticks`,
    cells: [],
    kind: "single",
    status: options?.status ?? "done",
    runRef: options?.runRef,
    folderId: options?.folderId ?? null,
    fullRunJson: JSON.stringify({
      manifest: run.manifest,
      history: run.history,
      finalWorld: run.finalWorld,
    }),
  };
}

export function createPendingBatch(input: {
  id?: string;
  name: string;
  kind: AnalysisBatchKind;
  folderId?: string | null;
  runRef: NonNullable<AnalysisBatch["runRef"]>;
  status?: AnalysisBatch["status"];
}): AnalysisBatch {
  const now = new Date().toISOString();
  return {
    id: input.id ?? newId("b"),
    name: input.name.trim() || `${input.kind} ${now.slice(0, 19)}`,
    createdAt: now,
    constructionMode: "pending",
    levelProductLabel: "pending",
    cells: [],
    kind: input.kind,
    status: input.status ?? "running",
    runRef: input.runRef,
    folderId: input.folderId ?? null,
    fullRunJson: undefined,
  };
}

export function reviveStoredSingleRun(json: string): SimulationRun & { finalWorld?: WorldState } {
  const o = JSON.parse(json) as {
    manifest: unknown;
    history: unknown;
    finalWorld?: WorldState;
  };
  const base = parseRun(JSON.stringify({ manifest: o.manifest, history: o.history }));
  return { ...base, finalWorld: o.finalWorld };
}

export function buildContextForAgent(project: AnalysisProject, batchId: string): string {
  const batch = project.batches.find((b) => b.id === batchId);
  if (!batch) return "";
  if (batch.kind === "single") {
    return [
      `# Project: ${project.name}`,
      `Single run: ${batch.name} (${batch.createdAt})`,
      batch.fullRunJson ? `\`\`\`json\n${batch.fullRunJson.slice(0, 12_000)}${batch.fullRunJson.length > 12_000 ? "\n…(truncated)" : ""}\n\`\`\`` : "",
      "",
    ].join("\n");
  }
  const lines: string[] = [
    `# Project: ${project.name}`,
    `Batch: ${batch.name} (${batch.createdAt}) · ${batch.kind}`,
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
