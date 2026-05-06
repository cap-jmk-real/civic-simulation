import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const require = createRequire(import.meta.url);

/**
 * Ensures `scripts/sim-worker.ts` is part of the TS program and has no missing imports /
 * undefined symbols. This would have caught `makeOptimizationTrialId is not defined` at
 * compile time before the worker ever ran.
 */
describe("sim-worker script (TypeScript)", () => {
  it(
    "typechecks apps/web (includes scripts/sim-worker.ts)",
    { timeout: 120_000 },
    () => {
      const webRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
      const tscBin = require.resolve("typescript/bin/tsc");
      try {
        execFileSync(process.execPath, [tscBin, "--noEmit", "-p", path.join(webRoot, "tsconfig.json")], {
          cwd: webRoot,
          stdio: "pipe",
        });
      } catch (err) {
        const e = err as { stdout?: unknown; stderr?: unknown; message?: string };
        const stdout = Buffer.isBuffer(e.stdout) ? e.stdout.toString("utf8") : String(e.stdout ?? "");
        const stderr = Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : String(e.stderr ?? "");
        const base = e && typeof e.message === "string" ? e.message : String(err);
        throw new Error([base, stdout && `\n[tsc stdout]\n${stdout}`, stderr && `\n[tsc stderr]\n${stderr}`].filter(Boolean).join("\n"));
      }
    },
  );
});
