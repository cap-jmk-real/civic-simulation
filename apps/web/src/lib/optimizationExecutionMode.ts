export type OptimizationExecutionPreference = "non-blocking" | "main-thread";
export type OptimizationExecutionMode = "worker" | "main-thread";

export function resolveOptimizationExecutionMode(
  preference: OptimizationExecutionPreference,
  supportsWorkers: boolean,
): {
  mode: OptimizationExecutionMode;
  fallback: boolean;
} {
  if (preference === "main-thread") {
    return { mode: "main-thread", fallback: false };
  }
  if (supportsWorkers) {
    return { mode: "worker", fallback: false };
  }
  return { mode: "main-thread", fallback: true };
}
