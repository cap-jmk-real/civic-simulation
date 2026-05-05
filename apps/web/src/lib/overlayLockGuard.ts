export type LabInteractionActivity = {
  running: boolean;
  enqueueBusy: boolean;
  gridRunnerActive: boolean;
  optimizationRunnerActive: boolean;
};

export function isLabInteractionActive(activity: LabInteractionActivity): boolean {
  return (
    activity.running ||
    activity.enqueueBusy ||
    activity.gridRunnerActive ||
    activity.optimizationRunnerActive
  );
}

export function shouldClearStaleOverlay(prevActive: boolean, nextActive: boolean): boolean {
  return prevActive && !nextActive;
}
