#!/usr/bin/env node
/**
 * Runs Next.js + sim worker with a shared absolute SQLite path so both processes
 * hit the same DB even if their process cwd differs.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(repoRoot, "apps", "web", "data", "sim-queue.db");
const env = { ...process.env, SIM_QUEUE_DB_PATH: dbPath };

const shell = process.platform === "win32";
const child = spawn(
  "pnpm",
  ["exec", "concurrently", "-k", "-n", "web,worker", "-c", "cyan,magenta", "pnpm dev", "pnpm sim:worker"],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell,
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
