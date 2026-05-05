import test from "node:test";
import assert from "node:assert/strict";

import { detectWindowsNodeGypFailure } from "./native-modules-doctor.js";
import { buildRebuildAttempts, isTransientLockFailure, resolvePnpmExecutables } from "./setup-native-modules.mjs";

test("buildRebuildAttempts includes filter and -C fallbacks", () => {
  const repoRoot = "C:/repo";
  const attempts = buildRebuildAttempts(repoRoot);
  const commandSet = new Set(attempts.map((entry) => entry.command));
  const argvs = attempts.map((entry) => entry.args.join(" "));

  if (process.platform === "win32") {
    assert.ok(commandSet.has("pnpm.cmd"));
    assert.ok(commandSet.has("pnpm"));
  } else {
    assert.deepEqual([...commandSet], ["pnpm"]);
  }

  assert.ok(argvs.includes("--filter web rebuild better-sqlite3"));
  assert.ok(argvs.includes("rebuild better-sqlite3 --filter web"));
  assert.ok(argvs.some((args) => args.endsWith("apps/web rebuild better-sqlite3") || args.endsWith("apps\\web rebuild better-sqlite3")));
});

test("resolvePnpmExecutables prefers npm_execpath when pnpm.cjs", () => {
  const executables = resolvePnpmExecutables({
    npm_execpath: "C:\\Users\\julian\\AppData\\Local\\pnpm\\.tools\\pnpm\\10.19.0\\bin\\pnpm.cjs",
  });
  assert.ok(executables.length > 0);
  assert.equal(executables[0].command, process.execPath);
  assert.deepEqual(executables[0].prefixArgs, [
    "C:\\Users\\julian\\AppData\\Local\\pnpm\\.tools\\pnpm\\10.19.0\\bin\\pnpm.cjs",
  ]);
  assert.equal(executables[0].source, "npm_execpath");
});

test("resolvePnpmExecutables falls back without npm_execpath", () => {
  const executables = resolvePnpmExecutables({});
  assert.ok(executables.every((entry) => entry.source !== "npm_execpath"));
  assert.ok(executables.some((entry) => entry.source === "corepack"));
  assert.ok(executables.some((entry) => entry.command === "pnpm"));
});

test("isTransientLockFailure classifies EPERM output as transient", () => {
  const detection = detectWindowsNodeGypFailure("gyp ERR! stack Error: EPERM: operation not permitted, unlink");
  const transient = isTransientLockFailure(
    {
      output: "EPERM: operation not permitted, unlink",
      error: null,
    },
    detection,
  );
  assert.equal(transient, true);
});
