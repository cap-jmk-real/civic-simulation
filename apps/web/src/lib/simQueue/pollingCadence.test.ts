import { describe, expect, it } from "vitest";
import { queuePollingIntervalMs } from "./pollingCadence";

describe("queuePollingIntervalMs", () => {
  it("uses long fallback interval when SSE is healthy", () => {
    expect(queuePollingIntervalMs({ sseConnected: true, hasActiveRuns: true, tabVisible: true })).toBe(30_000);
    expect(queuePollingIntervalMs({ sseConnected: true, hasActiveRuns: false, tabVisible: true })).toBe(45_000);
  });

  it("uses shorter polling when SSE drops during active work", () => {
    expect(queuePollingIntervalMs({ sseConnected: false, hasActiveRuns: true, tabVisible: true })).toBe(7_500);
  });

  it("backs off when idle and SSE is disconnected", () => {
    expect(queuePollingIntervalMs({ sseConnected: false, hasActiveRuns: false, tabVisible: true })).toBe(20_000);
  });

  it("heavily throttles while tab is hidden", () => {
    expect(queuePollingIntervalMs({ sseConnected: true, hasActiveRuns: true, tabVisible: false })).toBe(60_000);
    expect(queuePollingIntervalMs({ sseConnected: false, hasActiveRuns: true, tabVisible: false })).toBe(60_000);
  });
});
