import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jobRowToDetailApiJson } from "./jobDetailForApi";
import type { SimJobRow } from "./types";

const ORIGINAL_DB_PATH = process.env.SIM_QUEUE_DB_PATH;

function sampleRow(overrides?: Partial<SimJobRow>): SimJobRow {
  return {
    id: "job-1",
    status: "done",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
    heartbeat_at: "2026-01-01T00:00:01.000Z",
    payload_json: JSON.stringify({ policyMode: "heuristic", config: {} }),
    error_text: null,
    result_json: null,
    progress_note: "complete",
    status_note: null,
    ...overrides,
  };
}

afterEach(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.SIM_QUEUE_DB_PATH;
  else process.env.SIM_QUEUE_DB_PATH = ORIGINAL_DB_PATH;
});

describe("jobRowToDetailApiJson", () => {
  it("returns inline result_json when not a stored pointer", () => {
    const row = sampleRow({ result_json: JSON.stringify({ manifest: { seed: 1 }, history: [] }) });
    const out = jobRowToDetailApiJson(row);
    expect(out.result_json).toBe(row.result_json);
  });

  it("resolves stored pointer payload from sim-results directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sim-job-detail-"));
    process.env.SIM_QUEUE_DB_PATH = path.join(root, "sim-queue.db");
    const rel = "sim-results/job-1.json";
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify({ manifest: { seed: 7 }, history: [{ metrics: { tick: 1 } }] }), "utf8");
    const row = sampleRow({
      result_json: JSON.stringify({ _storedPath: rel, _bytes: 123 }),
    });
    const out = jobRowToDetailApiJson(row);
    expect(out.result_json).toContain('"manifest"');
    expect(out.result_json).toContain('"history"');
  });
});
