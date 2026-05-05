#!/usr/bin/env node
/**
 * Runs Next.js + sim worker with a shared absolute SQLite path so both processes
 * hit the same DB even if their process cwd differs.
 *
 * Avoid shell-based launchers here: direct child processes are much more reliable
 * on Windows than passing nested commands through `cmd.exe`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = path.join(repoRoot, "apps", "web", "data", "sim-queue.db");
const sharedEnv = { ...process.env, SIM_QUEUE_DB_PATH: dbPath };
const useAnsiColor =
  !("NO_COLOR" in process.env) &&
  Boolean(process.stdout.isTTY || process.stderr.isTTY || process.env.FORCE_COLOR);

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function getPnpmCommand() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      baseArgs: [process.env.npm_execpath],
    };
  }

  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    baseArgs: [],
  };
}

function colorize(text, ...codes) {
  if (!useAnsiColor) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function getPrefix({ label, kind }) {
  if (kind === "stderr") {
    return colorize(`[${label}:err]`, ANSI.red);
  }

  const labelColor = label === "web" ? ANSI.cyan : ANSI.magenta;
  return colorize(`[${label}]`, labelColor);
}

function prefixStream(stream, { label, kind }) {
  let buffered = "";
  const target = kind === "stderr" ? process.stderr : process.stdout;

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`${getPrefix({ label, kind })} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffered.length > 0) {
      target.write(`${getPrefix({ label, kind })} ${buffered}\n`);
    }
  });
}

const pnpm = getPnpmCommand();
const processes = [
  { label: "web", args: ["dev"] },
  { label: "worker", args: ["sim:worker"] },
];

let shuttingDown = false;
let exitCode = 0;
const children = [];

function stopAll(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

console.log(`[dev:all] SIM_QUEUE_DB_PATH=${dbPath}`);

for (const proc of processes) {
  console.log(`[dev:all] starting ${proc.label}: pnpm ${proc.args.join(" ")}`);
  const child = spawn(pnpm.command, [...pnpm.baseArgs, ...proc.args], {
    cwd: repoRoot,
    env: sharedEnv,
    stdio: ["inherit", "pipe", "pipe"],
    shell: false,
  });

  prefixStream(child.stdout, { label: proc.label, kind: "stdout" });
  prefixStream(child.stderr, { label: proc.label, kind: "stderr" });

  child.on("error", (error) => {
    console.error(`${colorize(`[${proc.label}:err]`, ANSI.red)} Failed to start: ${error.message}`);
    exitCode = 1;
    stopAll();
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`${colorize(`[${proc.label}:err]`, ANSI.red)} exited via signal ${signal}`);
    } else if (code && code !== 0) {
      console.error(`${colorize(`[${proc.label}:err]`, ANSI.red)} exited with code ${code}`);
      exitCode = code;
    }

    stopAll();

    if (children.every((item) => item.exitCode !== null || item.signalCode !== null)) {
      process.exit(exitCode);
    }
  });

  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    exitCode = exitCode || 130;
    stopAll(signal);
  });
}
