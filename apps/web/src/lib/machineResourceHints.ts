/**
 * Browser-side **signals** for CPU / memory — not OS-wide caps.
 *
 * The page cannot read total machine RAM, reserve physical cores, or throttle
 * other tabs/processes. Values here are hints for UI defaults, ceilings on
 * user-controlled concurrency (when added), and honest copy in the lab.
 */

/** Chromium-only shape; not in TypeScript DOM lib by default. */
export type ChromiumPerformanceMemory = {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
};

export type MachineCpuHint =
  | {
      kind: "logical";
      /** `navigator.hardwareConcurrency` — logical processors available to the page (may be lowered for privacy or VMs). */
      cores: number;
      source: "navigator.hardwareConcurrency";
    }
  | { kind: "unknown"; source: "unavailable" };

export type MachineMemoryHintMb =
  | {
      kind: "js_heap_limit";
      /** Upper bound on V8’s JS heap for this renderer process (bytes → MB). Not system RAM. */
      limitMb: number;
      usedMb?: number;
      source: "performance.memory";
    }
  | {
      kind: "unavailable";
      source: "not_exposed";
      /** Short reason for UI / logs (Safari/Firefox omit `performance.memory`; SSR has no `performance`). */
      reason: string;
    };

function readChromiumMemory(): ChromiumPerformanceMemory | null {
  if (typeof performance === "undefined") return null;
  const m = (performance as unknown as { memory?: ChromiumPerformanceMemory }).memory;
  if (!m || typeof m.jsHeapSizeLimit !== "number" || !Number.isFinite(m.jsHeapSizeLimit)) {
    return null;
  }
  return m;
}

/**
 * Logical CPU count exposed to scripts.
 *
 * **Safari / Firefox:** supported in modern versions, but the value can be
 * coarse or privacy-reduced. **SSR / non-browser:** always unknown.
 */
export function getMachineCpuHint(): MachineCpuHint {
  if (typeof navigator === "undefined" || typeof navigator.hardwareConcurrency !== "number") {
    return { kind: "unknown", source: "unavailable" };
  }
  const n = navigator.hardwareConcurrency;
  if (!Number.isFinite(n) || n < 1) {
    return { kind: "unknown", source: "unavailable" };
  }
  return {
    kind: "logical",
    cores: Math.min(256, Math.max(1, Math.floor(n))),
    source: "navigator.hardwareConcurrency",
  };
}

const BYTES_PER_MB = 1024 * 1024;

/**
 * JS heap **limit** in MB when Chromium exposes `performance.memory`.
 *
 * **Not detectable here:** physical RAM, WASM linear memory ceiling separate
 * from the JS heap, GPU memory. **Safari / Firefox:** `performance.memory` is
 * absent → `unavailable`. **Chromium:** `jsHeapSizeLimit` is per-renderer JS
 * heap cap (useful as a rough “don’t assume infinite RAM in this tab” hint),
 * not “you may allocate X MB of WASM”.
 */
export function getMachineMemoryHintMb(): MachineMemoryHintMb {
  if (typeof performance === "undefined") {
    return { kind: "unavailable", source: "not_exposed", reason: "no_performance_global" };
  }
  const mem = readChromiumMemory();
  if (!mem) {
    return {
      kind: "unavailable",
      source: "not_exposed",
      reason: "performance.memory_missing",
    };
  }
  const limitMb = Math.round(mem.jsHeapSizeLimit / BYTES_PER_MB);
  const usedMb = Number.isFinite(mem.usedJSHeapSize)
    ? Math.round(mem.usedJSHeapSize / BYTES_PER_MB)
    : undefined;
  return {
    kind: "js_heap_limit",
    limitMb: Math.max(1, limitMb),
    usedMb,
    source: "performance.memory",
  };
}

/**
 * Clamp a requested parallel worker count to the CPU hint.
 * When the hint is unknown, returns at least 1 and at most `requested`.
 */
export function clampConcurrencyToMachineCpuHint(requested: number, hint: MachineCpuHint): number {
  const r = Math.max(1, Math.floor(requested));
  if (hint.kind !== "logical") return Math.min(r, 8);
  return Math.min(r, Math.max(1, hint.cores));
}

/**
 * Clamp a user MB budget to the JS heap limit hint when available.
 * When memory is unknown, returns `requested` unchanged (no false ceiling).
 */
export function clampMemoryBudgetMbToJsHeapHint(requestedMb: number, hint: MachineMemoryHintMb): number {
  const r = Math.max(1, Math.round(requestedMb));
  if (hint.kind !== "js_heap_limit") return r;
  return Math.min(r, Math.max(1, hint.limitMb));
}

export type MachineHintsSnapshot = { cpu: MachineCpuHint; mem: MachineMemoryHintMb };

/** Single-line readout for panels (no HTML). */
export function formatMachineHintsOneLine(snapshot: MachineHintsSnapshot): string {
  const cpu =
    snapshot.cpu.kind === "logical"
      ? `~${snapshot.cpu.cores} logical CPUs`
      : "logical CPUs unknown";
  const mem =
    snapshot.mem.kind === "js_heap_limit"
      ? `JS heap cap ~${snapshot.mem.limitMb} MB (Chromium)`
      : "JS heap cap n/a (try Chrome/Edge; not system RAM)";
  return `This device: ${cpu}; ${mem}.`;
}

/**
 * Ceiling for a future Web Worker pool from the CPU hint.
 * When `hardwareConcurrency` is missing, stay conservative — do not assume many cores.
 */
export function suggestedWorkerPoolCeilingFromCpuHint(hint: MachineCpuHint): number {
  return hint.kind === "logical" ? Math.max(1, hint.cores) : 8;
}
