/**
 * Prebuilt Rust market math (`ip-sim-wasm`) for the browser. Import only from
 * client components — the pack includes a `.wasm` binary.
 */
import { market_raw_weights, version as wasmVersion } from "@ip-sim/wasm";

export function compiledMarketKernelVersion(): string {
  return wasmVersion();
}

export { market_raw_weights };
