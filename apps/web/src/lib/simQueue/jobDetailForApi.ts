import fs from "node:fs";
import path from "node:path";
import type { SimJobPayload, SimJobRow } from "./types";
import { getSimQueueDataDir } from "./paths";

function tryResolveStoredResultJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { _storedPath?: unknown };
    if (parsed == null || typeof parsed !== "object" || typeof parsed._storedPath !== "string") return raw;
    const rel = parsed._storedPath.replace(/\\/g, "/");
    const abs = path.resolve(getSimQueueDataDir(), rel);
    const dataDir = path.resolve(getSimQueueDataDir());
    if (!abs.startsWith(dataDir)) return raw;
    if (!fs.existsSync(abs)) return raw;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return raw;
  }
}

function readResultMeta(raw: string | null): { storedPath: string | null; outputBytes: number | null } {
  if (!raw) return { storedPath: null, outputBytes: null };
  let storedPath: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { _storedPath?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed._storedPath === "string") {
      storedPath = parsed._storedPath;
    }
  } catch {
    // Keep best-effort metadata only.
  }
  return {
    storedPath,
    outputBytes: Buffer.byteLength(raw, "utf8"),
  };
}

/** JSON body for GET /api/sim/jobs/:id (also streamed over SSE job channel). */
export function jobRowToDetailApiJson(row: SimJobRow) {
  let payload: SimJobPayload | null = null;
  try {
    payload = JSON.parse(row.payload_json) as SimJobPayload;
  } catch {
    payload = null;
  }
  const resultMeta = readResultMeta(row.result_json);
  return {
    id: row.id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    heartbeat_at: row.heartbeat_at,
    progress_note: row.progress_note,
    status_note: row.status_note,
    error_text: row.error_text,
    result_json: tryResolveStoredResultJson(row.result_json),
    result_meta: resultMeta,
    payload,
  };
}
