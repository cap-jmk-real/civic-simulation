import { describe, expect, it } from "vitest";
import { migrateAnalysisStore } from "./analysisTypes";

describe("migrateAnalysisStore", () => {
  it("upgrades v2 batches with done status", () => {
    const migrated = migrateAnalysisStore({
      version: 2,
      projects: [
        {
          id: "p1",
          name: "Project 1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          folders: [],
          artifacts: [],
          batches: [
            {
              id: "b1",
              name: "Batch 1",
              createdAt: "2026-01-01T00:00:00.000Z",
              constructionMode: "full_factorial",
              levelProductLabel: "2x2",
              cells: [],
              kind: "grid",
              folderId: null,
            },
          ],
        },
      ],
    });

    expect(migrated.version).toBe(3);
    expect(migrated.projects[0]?.batches[0]?.status).toBe("done");
    expect(migrated.projects[0]?.batches[0]?.runRef).toBeUndefined();
  });
});
