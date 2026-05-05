import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasPersistedLabTrialRunPayload, resolveLabTrialFullRunJson } from "./labRunJsonResolver";

const TMP_ROOT = path.join(os.tmpdir(), "ip-sim-lab-run-json-resolver-tests");

afterEach(() => {
  delete process.env.SIM_QUEUE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("resolveLabTrialFullRunJson", () => {
  it("returns inline embedded full run when present in summary", () => {
    const dataDir = path.join(TMP_ROOT, "inline");
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.SIM_QUEUE_DB_PATH = path.join(dataDir, "sim-queue.db");
    const run = { manifest: { seed: 1 }, history: [{ metrics: { tick: 1 } }] };
    const got = resolveLabTrialFullRunJson({
      runSummaryJson: JSON.stringify({ _fullRun: run }),
      spilloverPath: null,
    });
    expect(got).toBe(JSON.stringify(run));
  });

  it("resolves _fullRunRef._storedPath pointer from summary", () => {
    const dataDir = path.join(TMP_ROOT, "ref");
    const rel = "lab-exports/session-1/eval-2-full.json";
    const abs = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{"manifest":{"seed":2},"history":[]}', "utf8");
    process.env.SIM_QUEUE_DB_PATH = path.join(dataDir, "sim-queue.db");
    const got = resolveLabTrialFullRunJson({
      runSummaryJson: JSON.stringify({ _fullRunRef: { _storedPath: rel, _bytes: 123 } }),
      spilloverPath: null,
    });
    expect(got).toBe('{"manifest":{"seed":2},"history":[]}');
  });

  it("resolves bundled _storedPath + nested _fullRunRef", () => {
    const dataDir = path.join(TMP_ROOT, "bundle");
    const bundleRel = "lab-exports/session-1/eval-4-bundle.json";
    const fullRel = "lab-exports/session-1/eval-4-full.json";
    const bundleAbs = path.join(dataDir, bundleRel);
    const fullAbs = path.join(dataDir, fullRel);
    fs.mkdirSync(path.dirname(bundleAbs), { recursive: true });
    fs.writeFileSync(bundleAbs, JSON.stringify({ _fullRunRef: { _storedPath: fullRel } }), "utf8");
    fs.writeFileSync(fullAbs, '{"manifest":{"seed":4},"history":[{"metrics":{"tick":3}}]}', "utf8");
    process.env.SIM_QUEUE_DB_PATH = path.join(dataDir, "sim-queue.db");
    const got = resolveLabTrialFullRunJson({
      runSummaryJson: JSON.stringify({ _storedPath: bundleRel }),
      spilloverPath: null,
    });
    expect(got).toBe('{"manifest":{"seed":4},"history":[{"metrics":{"tick":3}}]}');
  });
});

describe("hasPersistedLabTrialRunPayload", () => {
  it("is true when run summary contains inline full-run marker", () => {
    expect(
      hasPersistedLabTrialRunPayload({
        runSummaryJson: JSON.stringify({ _fullRun: { manifest: { seed: 7 }, history: [] } }),
        spilloverPath: null,
      }),
    ).toBe(true);
  });

  it("is true when spillover pointer exists without reading files", () => {
    expect(
      hasPersistedLabTrialRunPayload({
        runSummaryJson: null,
        spilloverPath: "lab-exports/session-1/eval-1-full.json",
      }),
    ).toBe(true);
  });

  it("is false when there is no persisted run reference", () => {
    expect(
      hasPersistedLabTrialRunPayload({
        runSummaryJson: JSON.stringify({ summaryOnly: true }),
        spilloverPath: null,
      }),
    ).toBe(false);
  });
});
