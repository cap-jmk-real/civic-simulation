import fs from "node:fs";
import path from "node:path";
import { getSimQueueDataDir } from "@/lib/simQueue/paths";

export type BackendLogLevel = "debug" | "info" | "warn" | "error";
type BackendLogMeta = Record<string, unknown> | undefined;

const LEVEL_PRIORITY: Record<BackendLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LOG_FILE = "backend.log";
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function parseLogLevel(raw: string | undefined): BackendLogLevel {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }
  return "info";
}

function parseMaxBytes(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 64 * 1024) return Math.floor(n);
  return DEFAULT_MAX_BYTES;
}

export function resolveBackendLogPath(): string {
  const custom = process.env.BACKEND_LOG_PATH?.trim();
  if (custom) return path.resolve(custom);
  return path.join(getSimQueueDataDir(), "logs", DEFAULT_LOG_FILE);
}

export function formatBackendLogLine(
  level: BackendLogLevel,
  component: string,
  message: string,
  meta?: BackendLogMeta,
  now: Date = new Date(),
): string {
  const base = `${now.toISOString()} ${level.toUpperCase()} [${component}] ${message}`;
  if (!meta || Object.keys(meta).length === 0) return `${base}\n`;
  try {
    return `${base} ${JSON.stringify(meta)}\n`;
  } catch (error) {
    const fallback = error instanceof Error ? error.message : String(error);
    return `${base} {"meta_error":"${fallback}"}\n`;
  }
}

function rotateIfNeeded(logPath: string, maxBytes: number) {
  try {
    const stat = fs.statSync(logPath);
    if (!stat.isFile() || stat.size < maxBytes) return;
  } catch {
    return;
  }
  const rotatedPath = `${logPath}.1`;
  try {
    if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
    fs.renameSync(logPath, rotatedPath);
  } catch {
    // If rotation fails, keep writing to the current file.
  }
}

function shouldLog(level: BackendLogLevel): boolean {
  const configured = parseLogLevel(process.env.BACKEND_LOG_LEVEL);
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[configured];
}

export function writeBackendLog(
  level: BackendLogLevel,
  component: string,
  message: string,
  meta?: BackendLogMeta,
) {
  if (!shouldLog(level)) return;
  const logPath = resolveBackendLogPath();
  const maxBytes = parseMaxBytes(process.env.BACKEND_LOG_MAX_BYTES);
  const line = formatBackendLogLine(level, component, message, meta);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    rotateIfNeeded(logPath, maxBytes);
    fs.appendFileSync(logPath, line, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[backendLogger] Failed to write log", { logPath, reason });
  }
}

export function createBackendLogger(component: string) {
  return {
    debug: (message: string, meta?: BackendLogMeta) => writeBackendLog("debug", component, message, meta),
    info: (message: string, meta?: BackendLogMeta) => writeBackendLog("info", component, message, meta),
    warn: (message: string, meta?: BackendLogMeta) => writeBackendLog("warn", component, message, meta),
    error: (message: string, meta?: BackendLogMeta) => writeBackendLog("error", component, message, meta),
  };
}
