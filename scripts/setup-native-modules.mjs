import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  detectWindowsNodeGypFailure,
  expectedAbiForNodeMajor,
  isNodeMajorSupported,
  probeBetterSqlite3Load,
  readRootNodeEngine,
} from "./native-modules-doctor.js";

function run(command, args, cwd, capture = false) {
  const proc = spawnSync(command, args, {
    cwd,
    stdio: capture ? "pipe" : "inherit",
    shell: false,
    env: process.env,
    encoding: capture ? "utf8" : undefined,
  });
  if (!capture) {
    return { status: proc.status ?? 1, output: "", stdout: "", stderr: "", error: proc.error ?? null };
  }
  const output = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;
  return {
    status: proc.status ?? 1,
    output,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    error: proc.error ?? null,
  };
}

function shellEscape(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function looksLikePnpmExecPath(execPath) {
  if (!execPath) return false;
  const normalized = String(execPath).toLowerCase().replace(/\\/g, "/");
  return normalized.endsWith("/pnpm.cjs") || normalized.includes("/pnpm/dist/pnpm.cjs");
}

export function resolvePnpmExecutables(env = process.env) {
  const executables = [];
  const npmExecPath = String(env?.npm_execpath ?? "");
  if (looksLikePnpmExecPath(npmExecPath)) {
    executables.push({
      command: process.execPath,
      prefixArgs: [npmExecPath],
      source: "npm_execpath",
    });
  }

  if (process.platform === "win32") {
    executables.push(
      { command: "corepack.cmd", prefixArgs: ["pnpm"], source: "corepack" },
      { command: "corepack", prefixArgs: ["pnpm"], source: "corepack" },
      { command: "pnpm.cmd", prefixArgs: [], source: "path" },
      { command: "pnpm", prefixArgs: [], source: "path" },
    );
  } else {
    executables.push(
      { command: "corepack", prefixArgs: ["pnpm"], source: "corepack" },
      { command: "pnpm", prefixArgs: [], source: "path" },
    );
  }
  return executables;
}

export function buildRebuildAttempts(repoRoot) {
  const baseVariants = [
    ["--filter", "web", "rebuild", "better-sqlite3"],
    ["rebuild", "better-sqlite3", "--filter", "web"],
    ["-C", path.join(repoRoot, "apps", "web"), "rebuild", "better-sqlite3"],
  ];
  const attempts = [];
  const pnpmExecutables = resolvePnpmExecutables();
  for (const executable of pnpmExecutables) {
    for (const args of baseVariants) {
      attempts.push({
        command: executable.command,
        args: [...executable.prefixArgs, ...args].map((arg) => String(arg)),
        cwd: repoRoot,
        source: executable.source,
      });
    }
  }
  return attempts;
}

export function isTransientLockFailure(runResult, detection) {
  const errorCode = runResult?.error?.code ? String(runResult.error.code).toUpperCase() : "";
  if (errorCode === "EPERM" || errorCode === "EBUSY") return true;
  if (detection?.hasFileLock) return true;
  const output = String(runResult?.output ?? "");
  return /\bEPERM\b/i.test(output) || /\bEBUSY\b/i.test(output) || /operation not permitted, unlink/i.test(output);
}

function formatAttempt(attempt, result) {
  const commandLine = `${attempt.command} ${attempt.args.map(shellEscape).join(" ")}`;
  const header = `[native-setup] Command failed: ${commandLine}`;
  const exitLine = `[native-setup] Exit status: ${result.status}${result.error ? `; spawn error: ${result.error.message}` : ""}`;
  const stdout = result.stdout ? `[native-setup] STDOUT:\n${result.stdout}` : "[native-setup] STDOUT: <empty>";
  const stderr = result.stderr ? `[native-setup] STDERR:\n${result.stderr}` : "[native-setup] STDERR: <empty>";
  return [header, exitLine, stdout, stderr].join("\n");
}

function printWindowsNodeGypGuidance(detection) {
  if (!detection) return;
  console.error("[native-setup] Windows node-gyp diagnostics:");
  if (detection.abiMismatch) {
    console.error(
      `[native-setup] ABI mismatch detected in native binary (built=${detection.abiMismatch.builtAbi}, runtime=${detection.abiMismatch.runtimeAbi}).`,
    );
    console.error(
      "[native-setup] This usually means stale native artifacts from an older Node major; clean reinstall is required.",
    );
  }
  if (detection.hasPythonFailure) {
    console.error("[native-setup] Python is missing or not configured for npm/node-gyp.");
    console.error("[native-setup] Check with: npm config get python");
    console.error("[native-setup] Set explicitly if needed: npm config set python \"py\"");
  }
  if (detection.hasVsFailure) {
    console.error(
      "[native-setup] Visual Studio Build Tools are missing/incomplete. Install Build Tools 2022 with:",
    );
    console.error("[native-setup]   - Desktop development with C++");
    console.error("[native-setup]   - MSVC v143 build tools");
    console.error("[native-setup]   - Windows 10/11 SDK");
  }
  if (detection.hasFileLock) {
    console.error(
      "[native-setup] Detected file lock (EPERM/EBUSY). Stop pnpm dev/sim worker and any node.exe process before reinstalling.",
    );
  }
  console.error("[native-setup] Recovery (PowerShell):");
  console.error(
    "[native-setup]   Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force",
  );
  console.error("[native-setup]   Remove-Item -Recurse -Force .\\node_modules");
  console.error("[native-setup]   Remove-Item -Recurse -Force .\\apps\\web\\node_modules");
  console.error("[native-setup]   Remove-Item -Force .\\package-lock.json -ErrorAction SilentlyContinue");
  console.error("[native-setup]   pnpm install");
  console.error("[native-setup]   pnpm setup:native");
}

function detectInstallClient() {
  const ua = String(process.env.npm_config_user_agent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("pnpm/")) return "pnpm";
  if (ua.includes("npm/")) return "npm";
  if (ua.includes("yarn/")) return "yarn";
  return "other";
}

function requireProbe(repoRoot) {
  const probe = probeBetterSqlite3Load(path.join(repoRoot, "apps", "web"));
  if (probe.ok) return probe;
  console.error("[native-setup] better-sqlite3 probe failed:");
  console.error(probe.errorMessage ?? "Unknown load failure.");
  if (probe.failureType === "missing-module") {
    console.error(
      "[native-setup] Missing dependency: better-sqlite3 is not installed in the pnpm workspace.",
    );
    console.error("[native-setup] Run `pnpm install` from repo root, then retry.");
  }
  if (probe.abiMismatch) {
    console.error(
      `[native-setup] ABI mismatch: module=${probe.abiMismatch.builtAbi}, runtime=${probe.abiMismatch.runtimeAbi}.`,
    );
  }
  return probe;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const mode = process.argv.includes("--doctor") ? "doctor" : process.argv.includes("--guard") ? "guard" : "fix";
  const installClient = detectInstallClient();
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const runtimeAbi = Number(process.versions.modules);
  const expectedAbi = expectedAbiForNodeMajor(nodeMajor);
  const engineRange = readRootNodeEngine(repoRoot);
  const support = isNodeMajorSupported(nodeMajor, engineRange);

  console.log(
    `[native-setup] Node ${process.version} (ABI ${runtimeAbi}) via ${process.execPath}; ${support.reason}`,
  );
  if (mode === "fix" && installClient !== "pnpm") {
    console.warn(
      `[native-setup] Install client is '${installClient}', but this repo uses pnpm workspaces.`,
    );
    console.warn("[native-setup] Use `pnpm install` from repo root to install workspace dependencies correctly.");
    if (installClient === "npm") {
      console.warn(
        "[native-setup] Skipping native rebuild during npm postinstall to avoid opaque failures. Re-run with pnpm.",
      );
    }
    process.exit(0);
  }

  if (expectedAbi !== null && expectedAbi !== runtimeAbi) {
    console.warn(`[native-setup] Runtime ABI ${runtimeAbi} differs from expected ABI ${expectedAbi} for Node ${nodeMajor}.`);
  }
  if (!support.ok) {
    console.error(
      "[native-setup] Fix Node version first (for nvm-windows: `nvm use 24`) then run `pnpm setup:native`.",
    );
    process.exit(1);
  }

  const probeBefore = requireProbe(repoRoot);
  if (probeBefore.ok && (mode === "doctor" || mode === "guard")) {
    console.log("[native-setup] better-sqlite3 loads successfully.");
    process.exit(0);
  }
  if (mode === "guard") {
    if (!probeBefore.ok && installClient === "npm") {
      console.error(
        "[native-setup] This repo uses pnpm workspaces. `npm run dev` does not install workspace dependencies.",
      );
      console.error("[native-setup] Recovery: run `pnpm install` from repo root, then re-run dev.");
    }
    if (probeBefore.failureType === "missing-module") {
      console.error("[native-setup] Native guard failed due to missing workspace dependencies.");
    } else {
      console.error(
        "[native-setup] Native guard failed. Stop dev/worker, run `nvm use 24`, then `pnpm setup:native`.",
      );
    }
    process.exit(1);
  }

  if (!probeBefore.ok) {
    console.warn("[native-setup] better-sqlite3 failed to load; rebuilding native module.");
  } else {
    console.log("[native-setup] Rebuilding better-sqlite3 for active Node runtime.");
  }

  const shouldDiagnoseWindows = process.platform === "win32";
  const rebuildAttempts = buildRebuildAttempts(repoRoot);
  let rebuild = null;
  let rebuildDetection = null;
  let lastFailureResult = null;
  const failures = [];
  for (const attempt of rebuildAttempts) {
    const result = run(attempt.command, attempt.args, attempt.cwd, true);
    if (result.status === 0) {
      rebuild = result;
      break;
    }
    const detection = shouldDiagnoseWindows ? detectWindowsNodeGypFailure(result.output) : null;
    rebuildDetection = detection;
    lastFailureResult = result;
    failures.push(formatAttempt(attempt, result));
  }
  if (!rebuild) {
    console.error("[native-setup] Unable to rebuild better-sqlite3 for active Node runtime.");
    console.error(failures.join("\n\n"));
    if (shouldDiagnoseWindows) {
      printWindowsNodeGypGuidance(rebuildDetection);
    }
    if (mode === "fix" && isTransientLockFailure(lastFailureResult, rebuildDetection)) {
      console.warn("[native-setup] Continuing postinstall despite transient file-lock error.");
      console.warn(
        "[native-setup] Close running dev/worker/node processes, then run `pnpm -C apps/web rebuild better-sqlite3` or `pnpm setup:native`.",
      );
      process.exit(0);
    }
    process.exit(1);
  }

  const probeAfter = requireProbe(repoRoot);
  if (!probeAfter.ok) {
    console.error(
      "[native-setup] better-sqlite3 still fails to load after rebuild. Try removing node_modules and reinstalling.",
    );
    process.exit(1);
  }

  console.log("[native-setup] Native module is healthy.");
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
