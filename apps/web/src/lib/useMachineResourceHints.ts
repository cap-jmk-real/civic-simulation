"use client";

import { useSyncExternalStore } from "react";
import {
  getMachineCpuHint,
  getMachineMemoryHintMb,
  type MachineCpuHint,
  type MachineMemoryHintMb,
} from "@/lib/machineResourceHints";

/** Referentially stable — required by `useSyncExternalStore` for `getServerSnapshot`. */
const SERVER_SNAPSHOT: { cpu: MachineCpuHint; mem: MachineMemoryHintMb } = {
  cpu: { kind: "unknown", source: "unavailable" },
  mem: { kind: "unavailable", source: "not_exposed", reason: "server_or_hydration" },
};

function subscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): { cpu: MachineCpuHint; mem: MachineMemoryHintMb } {
  return SERVER_SNAPSHOT;
}

function hintsEqual(
  a: { cpu: MachineCpuHint; mem: MachineMemoryHintMb },
  b: { cpu: MachineCpuHint; mem: MachineMemoryHintMb },
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let clientSnapshotCache: { cpu: MachineCpuHint; mem: MachineMemoryHintMb } | null = null;

/** `usedJSHeapSize` changes every tick → unstable snapshots → `useSyncExternalStore` update loops. */
function memHintForStore(raw: MachineMemoryHintMb): MachineMemoryHintMb {
  if (raw.kind !== "js_heap_limit") return raw;
  return {
    kind: "js_heap_limit",
    limitMb: raw.limitMb,
    source: raw.source,
  };
}

function getClientSnapshot(): { cpu: MachineCpuHint; mem: MachineMemoryHintMb } {
  const next = { cpu: getMachineCpuHint(), mem: memHintForStore(getMachineMemoryHintMb()) };
  if (clientSnapshotCache !== null && hintsEqual(clientSnapshotCache, next)) {
    return clientSnapshotCache;
  }
  clientSnapshotCache = next;
  return clientSnapshotCache;
}

/**
 * Hydration-safe machine hints: server and first hydrated frame match
 * placeholders; after hydration, client reads real `navigator` / `performance.memory`.
 */
export function useMachineResourceHints(): {
  cpu: MachineCpuHint;
  mem: MachineMemoryHintMb;
} {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
