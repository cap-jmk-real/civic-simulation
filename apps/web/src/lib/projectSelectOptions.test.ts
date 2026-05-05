import { describe, expect, it } from "vitest";
import type { AnalysisProject } from "@/lib/analysisTypes";
import { formatProjectOptionLabel, projectStatus } from "@/lib/projectSelectOptions";

function createProject(statuses: Array<"running" | "done" | "failed" | "cancelled">): AnalysisProject {
  const now = new Date().toISOString();
  return {
    id: "project_1",
    name: "Project Alpha",
    createdAt: now,
    updatedAt: now,
    folders: [],
    artifacts: [],
    batches: statuses.map((status, idx) => ({
      id: `batch_${idx}`,
      name: `Batch ${idx}`,
      createdAt: now,
      constructionMode: "single",
      levelProductLabel: "n/a",
      cells: [],
      kind: "single",
      status,
      runRef: undefined,
      folderId: null,
      fullRunJson: undefined,
    })),
  };
}

describe("projectSelectOptions", () => {
  it("prioritizes running status over others", () => {
    const project = createProject(["done", "running", "failed"]);
    expect(projectStatus(project)).toBe("running");
    expect(formatProjectOptionLabel(project)).toBe("● Project Alpha");
  });

  it("returns plain label when no running batches exist", () => {
    const project = createProject(["done", "failed"]);
    expect(projectStatus(project)).toBe("failed");
    expect(formatProjectOptionLabel(project)).toBe("Project Alpha");
  });
});
