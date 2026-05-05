import { z } from "zod";

/** Final-tick metrics we persist for each grid cell (compact, no full history). */
export const storedCellMetricsSchema = z.object({
  tick: z.number(),
  tickCount: z.number(),
  giniWealth: z.number().optional(),
  meanWealth: z.number().optional(),
  totalWealth: z.number().optional(),
  innovationFlow: z.number().optional(),
  innovationFlowPerAgent: z.number().optional(),
  top10WealthShare: z.number().optional(),
});

export type StoredCellMetrics = z.infer<typeof storedCellMetricsSchema>;

export const storedAssignmentSchema = z.object({
  id: z.string(),
  value: z.union([z.number(), z.string()]),
});

export const storedCellSchema = z.object({
  id: z.string(),
  label: z.string(),
  assignments: z.array(storedAssignmentSchema),
  metrics: storedCellMetricsSchema,
  simSeed: z.number(),
  simTicks: z.number(),
});

export type StoredCell = z.infer<typeof storedCellSchema>;

export const analysisBatchKindSchema = z.enum(["grid", "optimization", "single"]);
export type AnalysisBatchKind = z.infer<typeof analysisBatchKindSchema>;

export const analysisBatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  constructionMode: z.string(),
  levelProductLabel: z.string(),
  cells: z.array(storedCellSchema),
  kind: analysisBatchKindSchema,
  status: z.enum(["running", "done", "failed", "cancelled"]).default("done"),
  runRef: z
    .object({
      kind: z.enum(["lab_session", "sim_job"]),
      id: z.string(),
    })
    .optional(),
  folderId: z.string().nullable().optional(),
  /** Serialized `SimulationRun` (no `finalWorld`) when `kind === "single"`. */
  fullRunJson: z.string().optional(),
  /** Client-side hydration status for queued sim-job run payload attachment. */
  simJobHydration: z.enum(["done", "skipped"]).optional(),
});

export type AnalysisBatch = z.infer<typeof analysisBatchSchema>;

export const analysisFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
});

export type AnalysisFolder = z.infer<typeof analysisFolderSchema>;

/** Markdown or plain text produced by the analysis agent; lives under a folder. */
export const analysisArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  folderId: z.string().nullable(),
  createdAt: z.string(),
  content: z.string(),
});

export type AnalysisArtifact = z.infer<typeof analysisArtifactSchema>;

export const analysisProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  folders: z.array(analysisFolderSchema),
  artifacts: z.array(analysisArtifactSchema),
  batches: z.array(analysisBatchSchema),
});

export type AnalysisProject = z.infer<typeof analysisProjectSchema>;

export const analysisStoreSchema = z.object({
  version: z.literal(3),
  projects: z.array(analysisProjectSchema),
});

export type AnalysisStore = z.infer<typeof analysisStoreSchema>;

/** Legacy v1 shape (no folders / artifacts / batch kind). */
const analysisBatchSchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  constructionMode: z.string(),
  levelProductLabel: z.string(),
  cells: z.array(storedCellSchema),
});

const analysisProjectSchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  batches: z.array(analysisBatchSchemaV1),
});

const analysisStoreSchemaV1 = z.object({
  version: z.literal(1),
  projects: z.array(analysisProjectSchemaV1),
});

const analysisStoreSchemaV2 = z.object({
  version: z.literal(2),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      folders: z.array(analysisFolderSchema),
      artifacts: z.array(analysisArtifactSchema),
      batches: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.string(),
          constructionMode: z.string(),
          levelProductLabel: z.string(),
          cells: z.array(storedCellSchema),
          kind: analysisBatchKindSchema,
          folderId: z.string().nullable().optional(),
          fullRunJson: z.string().optional(),
          simJobHydration: z.enum(["done", "skipped"]).optional(),
        }),
      ),
    }),
  ),
});

export function migrateAnalysisStore(raw: unknown): AnalysisStore {
  const v2 = analysisStoreSchema.safeParse(raw);
  if (v2.success) return v2.data;

  const vLegacy2 = analysisStoreSchemaV2.safeParse(raw);
  if (vLegacy2.success) {
    return {
      version: 3,
      projects: vLegacy2.data.projects.map((p) => ({
        ...p,
        batches: p.batches.map((b) => ({
          ...b,
          status: "done" as const,
          runRef: undefined,
        })),
      })),
    };
  }

  const v1 = analysisStoreSchemaV1.safeParse(raw);
  if (v1.success) {
    return {
      version: 3,
      projects: v1.data.projects.map((p) => ({
        ...p,
        folders: [],
        artifacts: [],
        batches: p.batches.map((b) => ({
          ...b,
          kind: "grid" as const,
          status: "done" as const,
          runRef: undefined,
          folderId: null,
          fullRunJson: undefined,
        })),
      })),
    };
  }

  return { version: 3, projects: [] };
}
