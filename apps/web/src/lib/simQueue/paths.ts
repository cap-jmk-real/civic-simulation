import path from "node:path";

/** Directory for SQLite DB and spillover result files (default: `<cwd>/data`). */
export function getSimQueueDataDir(): string {
  const raw = process.env.SIM_QUEUE_DB_PATH?.trim();
  if (raw) return path.dirname(path.resolve(raw));
  return path.resolve(process.cwd(), "data");
}

export function getSimQueueDbPath(): string {
  const raw = process.env.SIM_QUEUE_DB_PATH?.trim();
  if (raw) return path.resolve(raw);
  return path.join(getSimQueueDataDir(), "sim-queue.db");
}

export function getSimResultsDir(): string {
  return path.join(getSimQueueDataDir(), "sim-results");
}

/** Large lab trial/cell payloads (full runs) spill here: `data/lab-exports/<sessionId>/…`. */
export function getLabExportsDir(): string {
  return path.join(getSimQueueDataDir(), "lab-exports");
}
