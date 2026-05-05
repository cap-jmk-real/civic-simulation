import fs from "node:fs";
import path from "node:path";
import { getSimQueueDataDir } from "./paths";

type SummaryObject = {
  _storedPath?: unknown;
  _fullRun?: unknown;
  _fullRunRaw?: unknown;
  _fullRunRef?: { _storedPath?: unknown } | unknown;
};

function resolveStoredPathToAbsolute(storedPath: string): string | null {
  const rel = storedPath.replace(/\\/g, "/");
  const abs = path.resolve(getSimQueueDataDir(), rel);
  const root = path.resolve(getSimQueueDataDir());
  if (!abs.startsWith(root)) return null;
  return abs;
}

function tryReadStoredPath(storedPath: string): string | null {
  const abs = resolveStoredPathToAbsolute(storedPath);
  if (!abs) return null;
  if (!fs.existsSync(abs)) return null;
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function parseSummaryObject(raw: string): SummaryObject | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    return parsed as SummaryObject;
  } catch {
    return null;
  }
}

function resolveFromSummaryObject(summary: SummaryObject): string | null {
  if (summary._fullRun != null) {
    try {
      return JSON.stringify(summary._fullRun);
    } catch {
      return null;
    }
  }
  if (typeof summary._fullRunRaw === "string" && summary._fullRunRaw.length > 0) {
    return summary._fullRunRaw;
  }
  if (summary._fullRunRef && typeof summary._fullRunRef === "object") {
    const refPath = (summary._fullRunRef as { _storedPath?: unknown })._storedPath;
    if (typeof refPath === "string" && refPath.length > 0) {
      return tryReadStoredPath(refPath);
    }
  }
  return null;
}

function hasInlineRunMarker(summary: SummaryObject): boolean {
  if (summary._fullRun != null) return true;
  if (typeof summary._fullRunRaw === "string" && summary._fullRunRaw.length > 0) return true;
  if (summary._fullRunRef && typeof summary._fullRunRef === "object") {
    const refPath = (summary._fullRunRef as { _storedPath?: unknown })._storedPath;
    if (typeof refPath === "string" && refPath.length > 0) return true;
  }
  if (typeof summary._storedPath === "string" && summary._storedPath.length > 0) return true;
  return false;
}

/** Fast metadata-only payload check; never touches the filesystem. */
export function hasPersistedLabTrialRunPayload(input: {
  runSummaryJson: string | null;
  spilloverPath: string | null;
}): boolean {
  if (typeof input.spilloverPath === "string" && input.spilloverPath.length > 0) return true;
  if (typeof input.runSummaryJson !== "string" || input.runSummaryJson.length === 0) return false;
  const summary = parseSummaryObject(input.runSummaryJson);
  if (!summary) return false;
  return hasInlineRunMarker(summary);
}

/**
 * Resolves the persisted optimization trial run JSON from inline summary and/or spillover references.
 */
export function resolveLabTrialFullRunJson(input: {
  runSummaryJson: string | null;
  spilloverPath: string | null;
}): string | null {
  const fromSummary = input.runSummaryJson ? parseSummaryObject(input.runSummaryJson) : null;
  if (fromSummary) {
    const inSummary = resolveFromSummaryObject(fromSummary);
    if (inSummary) return inSummary;
    if (typeof fromSummary._storedPath === "string" && fromSummary._storedPath.length > 0) {
      const bundled = tryReadStoredPath(fromSummary._storedPath);
      if (bundled) {
        const bundledSummary = parseSummaryObject(bundled);
        if (bundledSummary) {
          const fromBundle = resolveFromSummaryObject(bundledSummary);
          if (fromBundle) return fromBundle;
        }
      }
    }
  }
  if (typeof input.spilloverPath === "string" && input.spilloverPath.length > 0) {
    const bundled = tryReadStoredPath(input.spilloverPath);
    if (bundled) {
      const bundledSummary = parseSummaryObject(bundled);
      if (bundledSummary) {
        const fromBundle = resolveFromSummaryObject(bundledSummary);
        if (fromBundle) return fromBundle;
      }
    }
  }
  return null;
}

/** Grid cell payload resolution follows the same persistence format as optimization trials. */
export function resolveLabBatchCellFullRunJson(input: {
  runSummaryJson: string | null;
  spilloverPath: string | null;
}): string | null {
  return resolveLabTrialFullRunJson(input);
}
