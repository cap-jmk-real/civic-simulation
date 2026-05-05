import type { AnalysisBatch, AnalysisProject } from "@/lib/analysisTypes";

export type ProjectOptionStatus = AnalysisBatch["status"];

export function projectStatus(project: AnalysisProject): ProjectOptionStatus {
  if (project.batches.some((batch) => batch.status === "running")) return "running";
  if (project.batches.some((batch) => batch.status === "failed")) return "failed";
  if (project.batches.some((batch) => batch.status === "cancelled")) return "cancelled";
  return "done";
}

export function formatProjectOptionLabel(project: AnalysisProject): string {
  return `${projectStatus(project) === "running" ? "● " : ""}${project.name}`;
}
