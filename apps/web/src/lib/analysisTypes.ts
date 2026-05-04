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

export const analysisBatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  constructionMode: z.string(),
  levelProductLabel: z.string(),
  cells: z.array(storedCellSchema),
});

export type AnalysisBatch = z.infer<typeof analysisBatchSchema>;

export const analysisProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  batches: z.array(analysisBatchSchema),
});

export type AnalysisProject = z.infer<typeof analysisProjectSchema>;

export const analysisStoreSchema = z.object({
  version: z.literal(1),
  projects: z.array(analysisProjectSchema),
});

export type AnalysisStore = z.infer<typeof analysisStoreSchema>;
