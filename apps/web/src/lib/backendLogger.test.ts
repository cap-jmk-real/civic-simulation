import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatBackendLogLine,
  resolveBackendLogPath,
  writeBackendLog,
} from "./backendLogger";

const envBackup = {
  BACKEND_LOG_PATH: process.env.BACKEND_LOG_PATH,
  BACKEND_LOG_LEVEL: process.env.BACKEND_LOG_LEVEL,
  BACKEND_LOG_MAX_BYTES: process.env.BACKEND_LOG_MAX_BYTES,
  SIM_QUEUE_DB_PATH: process.env.SIM_QUEUE_DB_PATH,
};

function restoreEnv() {
  process.env.BACKEND_LOG_PATH = envBackup.BACKEND_LOG_PATH;
  process.env.BACKEND_LOG_LEVEL = envBackup.BACKEND_LOG_LEVEL;
  process.env.BACKEND_LOG_MAX_BYTES = envBackup.BACKEND_LOG_MAX_BYTES;
  process.env.SIM_QUEUE_DB_PATH = envBackup.SIM_QUEUE_DB_PATH;
}

afterEach(() => {
  restoreEnv();
});

describe("backend logger", () => {
  it("formats line with metadata JSON", () => {
    const line = formatBackendLogLine(
      "info",
      "queue-api",
      "enqueued",
      { id: "job-1", status: "queued" },
      new Date("2026-05-05T10:00:00.000Z"),
    );
    expect(line).toBe(
      '2026-05-05T10:00:00.000Z INFO [queue-api] enqueued {"id":"job-1","status":"queued"}\n',
    );
  });

  it("resolves default log path under data/logs", () => {
    delete process.env.BACKEND_LOG_PATH;
    process.env.SIM_QUEUE_DB_PATH = path.join(os.tmpdir(), "sim-q", "queue.db");
    const resolved = resolveBackendLogPath();
    expect(resolved).toContain(path.join("sim-q", "logs", "backend.log"));
  });

  it("writes log file to configured path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backend-log-"));
    const logPath = path.join(dir, "backend.log");
    process.env.BACKEND_LOG_PATH = logPath;
    process.env.BACKEND_LOG_LEVEL = "info";
    writeBackendLog("info", "worker", "started", { pid: 1234 });
    const content = fs.readFileSync(logPath, "utf8");
    expect(content).toContain("INFO [worker] started");
    expect(content).toContain('"pid":1234');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
