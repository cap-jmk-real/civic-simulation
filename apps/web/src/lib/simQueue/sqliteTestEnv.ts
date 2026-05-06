import { createRequire } from "node:module";
import { describe, vi } from "vitest";

const require = createRequire(import.meta.url);

export function hasNativeSqlite(): boolean {
  try {
    const mod = require("better-sqlite3") as { default?: unknown } | ((p: string) => unknown);
    const DatabaseCtor = (mod as { default?: unknown }).default ?? mod;
    const db = new (DatabaseCtor as new (p: string) => { close: () => void })(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

export const describeSqlite = hasNativeSqlite() ? describe : describe.skip;

export async function withFreshQueueDb(dbPath: string, fn: () => Promise<void>) {
  process.env.SIM_QUEUE_DB_PATH = dbPath;
  vi.resetModules();
  try {
    await fn();
  } finally {
    const { closeQueueDbForTesting } = await import("./store");
    closeQueueDbForTesting();
    delete process.env.SIM_QUEUE_DB_PATH;
    vi.resetModules();
  }
}

