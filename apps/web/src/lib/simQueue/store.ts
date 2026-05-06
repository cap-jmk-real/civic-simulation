import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { createBackendLogger } from "@/lib/backendLogger";
import { getLabExportsDir, getSimQueueDataDir, getSimQueueDbPath, getSimResultsDir } from "./paths";
import type { SimJobPayload, SimJobRow, SimJobStatus } from "./types";

export const SIM_RESULT_JSON_MAX_BYTES = 2 * 1024 * 1024;
const SQLITE_OPEN_RETRY_MS = 10_000;
const STALE_HEARTBEAT_TIMEOUT_MS = Number(process.env.SIM_QUEUE_STALE_HEARTBEAT_MS ?? 90_000);

let dbSingleton: Database.Database | null = null;
let sqliteOpenBlockedUntil = 0;
let sqliteLastOpenError: unknown = null;
let sqliteLastLogAt = 0;
const queueStoreLogger = createBackendLogger("sim-queue-store");

export function isNativeSqliteUnavailableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    /better[_-]sqlite3/i.test(msg) &&
    (/NODE_MODULE_VERSION/i.test(msg) || /was compiled against/i.test(msg) || /could not locate the bindings file/i.test(msg))
  );
}

export function toNativeSqliteUnavailablePayload(error: unknown) {
  const msg = error instanceof Error ? error.message : String(error ?? "Unknown SQLite native module error");
  return {
    code: "native_module_unavailable",
    message: "SQLite native module is unavailable for the active Node runtime.",
    detail: msg,
    action: "Stop dev/worker processes, run `nvm use 24`, then `pnpm setup:native`.",
  };
}

function nowIso() {
  return new Date().toISOString();
}

/** Ensure default data roots exist (Windows-safe; supports custom SIM_QUEUE_DB_PATH outside data/). */
function ensureSimQueueDataLayout(dbPath: string) {
  const resolvedDbDir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(getSimQueueDataDir(), { recursive: true });
  fs.mkdirSync(resolvedDbDir, { recursive: true });
  fs.mkdirSync(getSimResultsDir(), { recursive: true });
  fs.mkdirSync(getLabExportsDir(), { recursive: true });
}

function tableNames(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function tableCreateSql(db: Database.Database, table: string): string {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql: string | null } | undefined;
  return row?.sql ?? "";
}

function rebuildJobsTableForInterruptedSupport(db: Database.Database) {
  db.exec(`
    CREATE TABLE jobs_v2 (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT,
      payload_json TEXT NOT NULL,
      error_text TEXT,
      result_json TEXT,
      progress_note TEXT,
      status_note TEXT,
      CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted'))
    );
    INSERT INTO jobs_v2 (
      id, status, created_at, updated_at, heartbeat_at, payload_json, error_text, result_json, progress_note, status_note
    )
    SELECT
      id, status, created_at, updated_at, updated_at, payload_json, error_text, result_json, progress_note, NULL
    FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_v2 RENAME TO jobs;
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
  `);
}

function rebuildLabSessionsTableForInterruptedSupport(db: Database.Database) {
  const cols = columnNames(db, "lab_sessions");
  const heartbeatExpr = cols.has("heartbeat_at") ? "COALESCE(heartbeat_at, updated_at)" : "updated_at";
  const statusNoteExpr = cols.has("status_note") ? "status_note" : "NULL";
  const projectIdExpr = cols.has("project_id") ? "project_id" : "NULL";
  const metaJsonExpr = cols.has("meta_json") ? "meta_json" : "'{}'";
  const bestTrialExpr = cols.has("best_trial_id") ? "best_trial_id" : "NULL";
  const curGenExpr = cols.has("opt_current_generation") ? "opt_current_generation" : "NULL";
  const curEvalExpr = cols.has("opt_current_evaluation_index") ? "opt_current_evaluation_index" : "NULL";
  const curStartedExpr = cols.has("opt_current_evaluation_started_at") ? "opt_current_evaluation_started_at" : "NULL";
  const lastDurExpr = cols.has("opt_last_evaluation_duration_ms") ? "opt_last_evaluation_duration_ms" : "NULL";
  const lastFinishedExpr = cols.has("opt_last_evaluation_finished_at") ? "opt_last_evaluation_finished_at" : "NULL";
  db.exec(`
    CREATE TABLE lab_sessions_v2 (
      id TEXT PRIMARY KEY,
      session_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT,
      status_note TEXT,
      project_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      best_trial_id TEXT,
      opt_current_generation INTEGER,
      opt_current_evaluation_index INTEGER,
      opt_current_evaluation_started_at TEXT,
      opt_last_evaluation_duration_ms REAL,
      opt_last_evaluation_finished_at TEXT,
      CHECK (session_type IN ('optimization', 'grid_batch')),
      CHECK (status IN ('queued', 'running', 'complete', 'cancelled', 'interrupted'))
    );
    INSERT INTO lab_sessions_v2 (
      id, session_type, status, created_at, updated_at, heartbeat_at, status_note, project_id, meta_json, best_trial_id,
      opt_current_generation, opt_current_evaluation_index, opt_current_evaluation_started_at,
      opt_last_evaluation_duration_ms, opt_last_evaluation_finished_at
    )
    SELECT
      id, session_type, status, created_at, updated_at, ${heartbeatExpr}, ${statusNoteExpr}, ${projectIdExpr}, ${metaJsonExpr}, ${bestTrialExpr},
      ${curGenExpr}, ${curEvalExpr}, ${curStartedExpr}, ${lastDurExpr}, ${lastFinishedExpr}
    FROM lab_sessions;
    DROP TABLE lab_sessions;
    ALTER TABLE lab_sessions_v2 RENAME TO lab_sessions;
    CREATE INDEX IF NOT EXISTS idx_lab_sessions_updated ON lab_sessions(updated_at DESC);
  `);
}

/** Older DBs may have a partial `lab_sessions` row shape; CREATE TABLE IF NOT EXISTS skips upgrades. */
function migrateLabSessionsIfNeeded(db: Database.Database) {
  if (!tableNames(db).has("lab_sessions")) return;
  const createSql = tableCreateSql(db, "lab_sessions");
  if (!createSql.includes("'interrupted'") || !createSql.includes("'queued'")) {
    rebuildLabSessionsTableForInterruptedSupport(db);
  }
  const cols = columnNames(db, "lab_sessions");
  const add = (name: string, ddl: string) => {
    if (cols.has(name)) return;
    db.exec(`ALTER TABLE lab_sessions ADD COLUMN ${ddl}`);
    cols.add(name);
  };
  add("project_id", "project_id TEXT");
  add("meta_json", "meta_json TEXT NOT NULL DEFAULT '{}'");
  add("best_trial_id", "best_trial_id TEXT");
  add("heartbeat_at", "heartbeat_at TEXT");
  add("status_note", "status_note TEXT");
  add("opt_current_generation", "opt_current_generation INTEGER");
  add("opt_current_evaluation_index", "opt_current_evaluation_index INTEGER");
  add("opt_current_evaluation_started_at", "opt_current_evaluation_started_at TEXT");
  add("opt_last_evaluation_duration_ms", "opt_last_evaluation_duration_ms REAL");
  add("opt_last_evaluation_finished_at", "opt_last_evaluation_finished_at TEXT");
}

function migrateLabTrialsIfNeeded(db: Database.Database) {
  if (!tableNames(db).has("lab_trials")) return;
  const cols = columnNames(db, "lab_trials");
  if (!cols.has("elapsed_ms")) {
    db.exec(`ALTER TABLE lab_trials ADD COLUMN elapsed_ms REAL`);
  }
}

export function getQueueDb(): Database.Database {
  if (dbSingleton) return dbSingleton;
  const dbPath = getSimQueueDbPath();
  const now = Date.now();
  if (sqliteLastOpenError && now < sqliteOpenBlockedUntil) {
    if (now - sqliteLastLogAt >= SQLITE_OPEN_RETRY_MS) {
      sqliteLastLogAt = now;
      queueStoreLogger.error("SQLite open retry paused", {
        retryInMs: sqliteOpenBlockedUntil - now,
      });
    }
    throw sqliteLastOpenError;
  }
  try {
    ensureSimQueueDataLayout(dbPath);
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    initSchema(db);
    dbSingleton = db;
    sqliteOpenBlockedUntil = 0;
    sqliteLastOpenError = null;
    sqliteLastLogAt = 0;
    return db;
  } catch (err) {
    const shouldLog = now >= sqliteOpenBlockedUntil;
    sqliteOpenBlockedUntil = now + SQLITE_OPEN_RETRY_MS;
    sqliteLastOpenError = err;
    if (shouldLog) {
      sqliteLastLogAt = now;
      queueStoreLogger.error("SQLite open/init failed", {
        dbPath,
        cwd: process.cwd(),
        simQueueDbPathEnv: process.env.SIM_QUEUE_DB_PATH ?? null,
        retryInMs: SQLITE_OPEN_RETRY_MS,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw sqliteLastOpenError;
  }
}

function jobsTableHasColumn(db: Database.Database, name: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  return rows.some((r) => r.name === name);
}

function migrateJobsTable(db: Database.Database) {
  if (!tableCreateSql(db, "jobs").includes("'interrupted'")) {
    rebuildJobsTableForInterruptedSupport(db);
  }
  if (!jobsTableHasColumn(db, "progress_note")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN progress_note TEXT`);
  }
  if (!jobsTableHasColumn(db, "heartbeat_at")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN heartbeat_at TEXT`);
  }
  if (!jobsTableHasColumn(db, "status_note")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN status_note TEXT`);
  }
}

function buildInterruptedStatusNote(prefix: string, now: string): string {
  return `${prefix}; recovered_at=${now}`;
}

function recoverStaleRunningRows(db: Database.Database) {
  const now = nowIso();
  const cutoffIso = new Date(Date.now() - Math.max(1, STALE_HEARTBEAT_TIMEOUT_MS)).toISOString();
  const jobNote = buildInterruptedStatusNote("stale heartbeat (owner process exited)", now);
  const sessionNote = buildInterruptedStatusNote("stale heartbeat (app/session owner exited)", now);
  db.prepare(
    `UPDATE jobs
     SET status = 'interrupted',
         updated_at = ?,
         heartbeat_at = ?,
         status_note = ?,
         progress_note = COALESCE(progress_note, ?)
     WHERE status = 'running'
       AND COALESCE(heartbeat_at, updated_at) < ?`,
  ).run(now, now, jobNote, jobNote, cutoffIso);
  db.prepare(
    `UPDATE lab_sessions
     SET status = 'interrupted',
         updated_at = ?,
         heartbeat_at = ?,
         status_note = ?
     WHERE status = 'running'
       AND COALESCE(heartbeat_at, updated_at) < ?`,
  ).run(now, now, sessionNote, cutoffIso);
}

function isMissingColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /no such column/i.test(message);
}

function recoverStaleRunningRowsSafely(db: Database.Database) {
  try {
    recoverStaleRunningRows(db);
  } catch (error) {
    if (isMissingColumnError(error)) {
      queueStoreLogger.error("Skipping stale row recovery due to legacy/missing schema columns", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    throw error;
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT,
      payload_json TEXT NOT NULL,
      error_text TEXT,
      result_json TEXT,
      progress_note TEXT,
      status_note TEXT,
      CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted'))
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS lab_schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO lab_schema_meta(key, value) VALUES ('user_version', '1');

    CREATE TABLE IF NOT EXISTS lab_sessions (
      id TEXT PRIMARY KEY,
      session_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      heartbeat_at TEXT,
      status_note TEXT,
      project_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      best_trial_id TEXT,
      opt_current_generation INTEGER,
      opt_current_evaluation_index INTEGER,
      opt_current_evaluation_started_at TEXT,
      opt_last_evaluation_duration_ms REAL,
      opt_last_evaluation_finished_at TEXT,
      CHECK (session_type IN ('optimization', 'grid_batch')),
      CHECK (status IN ('queued', 'running', 'complete', 'cancelled', 'interrupted'))
    );
    CREATE INDEX IF NOT EXISTS idx_lab_sessions_updated ON lab_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS lab_trials (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      evaluation_index INTEGER NOT NULL,
      assignments_json TEXT NOT NULL,
      metric_value REAL,
      mse REAL NOT NULL,
      elapsed_ms REAL,
      is_new_best INTEGER NOT NULL DEFAULT 0,
      run_summary_json TEXT,
      spillover_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, evaluation_index)
    );
    CREATE INDEX IF NOT EXISTS idx_lab_trials_session ON lab_trials(session_id, evaluation_index);

    CREATE TABLE IF NOT EXISTS lab_batch_cells (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cell_index INTEGER NOT NULL,
      cell_client_id TEXT,
      label TEXT,
      assignments_json TEXT NOT NULL,
      run_summary_json TEXT,
      spillover_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, cell_index)
    );
    CREATE INDEX IF NOT EXISTS idx_lab_batch_cells_session ON lab_batch_cells(session_id, cell_index);

    CREATE TABLE IF NOT EXISTS lab_eval_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      generation INTEGER,
      evaluation_index INTEGER,
      ts TEXT NOT NULL,
      elapsed_ms REAL,
      metric_value REAL,
      mse REAL,
      is_new_best INTEGER,
      detail_json TEXT,
      FOREIGN KEY (session_id) REFERENCES lab_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lab_eval_events_session_ts ON lab_eval_events(session_id, ts DESC);
  `);
  migrateJobsTable(db);
  migrateLabSessionsIfNeeded(db);
  migrateLabTrialsIfNeeded(db);
  recoverStaleRunningRowsSafely(db);
}

export function insertQueuedJob(payload: SimJobPayload): string {
  const db = getQueueDb();
  const id = randomUUID();
  const t = nowIso();
  db.prepare(
    `INSERT INTO jobs (id, status, created_at, updated_at, heartbeat_at, payload_json, progress_note, status_note)
     VALUES (?, 'queued', ?, ?, ?, ?, NULL, NULL)`,
  ).run(id, t, t, t, JSON.stringify(payload));
  return id;
}

export function listRecentJobs(limit = 50): SimJobRow[] {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, status, created_at, updated_at, heartbeat_at, payload_json, error_text, result_json, progress_note, status_note
       FROM jobs ORDER BY datetime(created_at) DESC LIMIT ?`,
    )
    .all(limit) as SimJobRow[];
}

export function getJob(id: string): SimJobRow | undefined {
  const db = getQueueDb();
  return db
    .prepare(
      `SELECT id, status, created_at, updated_at, heartbeat_at, payload_json, error_text, result_json, progress_note, status_note
       FROM jobs WHERE id = ?`,
    )
    .get(id) as SimJobRow | undefined;
}

/** Atomically claim the oldest queued job, or return null. */
export function claimNextQueuedJob(): string | null {
  const db = getQueueDb();
  const claim = db.transaction(() => {
    const row = db
      .prepare(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY datetime(created_at) ASC LIMIT 1`)
      .get() as { id: string } | undefined;
    if (!row) return null;
    const t = nowIso();
    const upd = db
      .prepare(
        `UPDATE jobs
         SET status = 'running', updated_at = ?, heartbeat_at = ?, progress_note = ?, status_note = NULL
         WHERE id = ? AND status = 'queued'`,
      )
      .run(t, t, "starting…", row.id);
    if (upd.changes === 0) return null;
    return row.id;
  });
  return claim();
}

export function updateJobProgress(id: string, note: string) {
  const db = getQueueDb();
  const t = nowIso();
  db.prepare(`UPDATE jobs SET updated_at = ?, heartbeat_at = ?, progress_note = ? WHERE id = ? AND status = 'running'`).run(
    t,
    t,
    note,
    id,
  );
}

export function heartbeatJob(id: string, note?: string) {
  const db = getQueueDb();
  const t = nowIso();
  if (note != null) {
    db.prepare(
      `UPDATE jobs
       SET updated_at = ?, heartbeat_at = ?, progress_note = ?
       WHERE id = ? AND status = 'running'`,
    ).run(t, t, note, id);
    return;
  }
  db.prepare(`UPDATE jobs SET updated_at = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'`).run(t, t, id);
}

/** Close the process-wide DB handle (tests and hot-reload isolation). */
export function closeQueueDbForTesting() {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  sqliteOpenBlockedUntil = 0;
  sqliteLastOpenError = null;
  sqliteLastLogAt = 0;
}

export function getJobStatus(id: string): SimJobStatus | undefined {
  const db = getQueueDb();
  const r = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id) as { status: SimJobStatus } | undefined;
  return r?.status;
}

export function failJob(id: string, message: string) {
  const db = getQueueDb();
  const t = nowIso();
  db.prepare(
    `UPDATE jobs
     SET status = 'failed', updated_at = ?, heartbeat_at = ?, error_text = ?, progress_note = ?, status_note = ?
     WHERE id = ? AND status = 'running'`,
  ).run(t, t, message, "failed", message, id);
}

export type CancelJobResult = "cancelled" | "already_terminal" | "not_found";

export function tryCancelJob(id: string): CancelJobResult {
  const db = getQueueDb();
  const row = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(id) as { status: SimJobStatus } | undefined;
  if (!row) return "not_found";
  if (row.status === "done" || row.status === "failed" || row.status === "cancelled" || row.status === "interrupted")
    return "already_terminal";
  const t = nowIso();
  const r = db
    .prepare(
      `UPDATE jobs
       SET status = 'cancelled', updated_at = ?, heartbeat_at = ?, progress_note = ?, status_note = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    )
    .run(
      t,
      t,
      row.status === "queued" ? "cancelled before start" : "cancelled",
      row.status === "queued" ? "cancelled before start" : "cancelled by user",
      id,
    );
  return r.changes > 0 ? "cancelled" : "already_terminal";
}

export function completeJobWithResult(id: string, resultJson: string) {
  const db = getQueueDb();
  const t = nowIso();
  const bytes = Buffer.byteLength(resultJson, "utf8");
  if (bytes <= SIM_RESULT_JSON_MAX_BYTES) {
    db.prepare(
      `UPDATE jobs
       SET status = 'done', updated_at = ?, heartbeat_at = ?, result_json = ?, error_text = NULL, progress_note = ?, status_note = NULL
       WHERE id = ? AND status = 'running'`,
    ).run(t, t, resultJson, "complete", id);
    return;
  }
  const dir = getSimResultsDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, resultJson, "utf8");
  const pointer = JSON.stringify({
    _storedPath: path.relative(getSimQueueDataDir(), filePath).replace(/\\/g, "/"),
    _bytes: bytes,
  });
  db.prepare(
    `UPDATE jobs
     SET status = 'done', updated_at = ?, heartbeat_at = ?, result_json = ?, error_text = NULL, progress_note = ?, status_note = NULL
     WHERE id = ? AND status = 'running'`,
  ).run(t, t, pointer, "complete (large result on disk)", id);
}
