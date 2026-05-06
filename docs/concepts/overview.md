# Concepts

This section explains the main pieces of the project at a high level.

## What you can do in the web lab

- Run **Heuristic** or **QRE** simulations in the browser.
- Replay runs, inspect networks/metrics over time, and export the run JSON.
- Sweep parameters with the **parameter grid**.
- (Optional) Queue long runs into a **local SQLite-backed job queue** processed by a **Node worker**.

## Where the simulation logic lives

- **Core simulation**: `packages/sim-core` (`@ip-sim/core`)
- **Web app (Lab UI)**: `apps/web`
- **Optional Rust engine**: `packages/ip-sim-engine`
- **Optional WASM build**: `packages/ip-sim-wasm` → `@ip-sim/wasm`

## Next steps

- Read the [Quickstart](/guide/quickstart).
- If you want background runs, read [Lab queue & worker](/guide/lab-queue).
- If you are on Windows, read [Windows native setup](/guide/windows-native).

