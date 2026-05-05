# Agent-based IP / information-sharing simulation

[![License: MIT or Apache-2.0](https://img.shields.io/badge/License-MIT%2FApache--2.0-blue?style=flat-square)](https://github.com/cap-jmk-real/civic-simulation)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Rust](https://img.shields.io/badge/Rust-1.85%2B-orange?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![WASM](https://img.shields.io/badge/WASM-wasm--pack-654FF0?style=flat-square&logo=webassembly&logoColor=white)](https://rustwasm.github.io/wasm-pack/)
[![Vitest](https://img.shields.io/badge/tests-Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![CodeRabbit Reviews](https://img.shields.io/coderabbit/prs/github/cap-jmk-real/civic-simulation?style=flat-square&utm_source=oss&utm_medium=github&utm_campaign=cap-jmk-real%2Fcivic-simulation&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)](https://coderabbit.ai)

pnpm monorepo implementing a discrete-time ABM with heterogeneous actors (**bigco**, **academic**, **smb**, **solo**), institutional IP/data-sharing knobs, collaboration networks, and society metrics (**Gini**, **HHI**, **innovation flow**, composite **power**).

## Packages

| Package | Purpose |
|--------|---------|
| `@ip-sim/core` | Simulation engine, policies (heuristic, QRE), metrics, JSON export — **API: [packages/sim-core/API.md](packages/sim-core/API.md)** · **Model & math: [packages/sim-core/SIMULATION_MATH.md](packages/sim-core/SIMULATION_MATH.md)** |
| **`ip-sim-engine` (Rust)** | Native CLI/library + benchmarks — **[SCALING.md](packages/ip-sim-engine/SCALING.md)** · `pnpm rust:test` |
| **`@ip-sim/wasm`** | **Same market kernel** as `.wasm` — ships **prebuilt** in `pkg/` so users only need `pnpm install` (no Rust). Rebuild after Rust edits: `pnpm wasm:build` (needs `wasm-pack` + `wasm32-unknown-unknown`). |
| `web` | Next.js UI; lazy-loads WASM for optional compiled market math — **Download run JSON** |
| `@ip-sim/remotion` | Optional Remotion composition reading exported `history` for MP4 renders |

**Persistence:** runs are exported as JSON from the browser. **Optional local job queue:** the lab’s **Queue** tab plus `POST /api/sim/jobs` store single-run jobs in **SQLite** (`data/sim-queue.db` under `apps/web` by default, or `SIM_QUEUE_DB_PATH`). A **separate Node process** (`pnpm sim:worker`) polls the DB and runs **TypeScript** heuristic/QRE simulations via `@ip-sim/core` (not browser WASM). **Serverless deployments** need the same pattern elsewhere (worker + durable store) or a managed queue (e.g. Redis/BullMQ) later.

## Quick start

```bash
pnpm install
pnpm dev:all
```

Use `pnpm install` for dependencies. Do not use `npm install` in this repo: it is a pnpm workspace and npm can leave workspace packages (including `apps/web` native deps like `better-sqlite3`) missing or broken.

End users do **not** install Rust or native binaries: the browser loads the packaged **`@ip-sim/wasm`** module from the repo (WebAssembly + JS glue).

Open [http://localhost:3000](http://localhost:3000). Choose **Heuristic** or **QRE** for fast runs; use **LLM** only with API keys configured.

### Simulation job queue (local dev)

1. Recommended: one terminal with `pnpm dev:all` (starts Next.js + worker together, Windows-friendly). This sets **`SIM_QUEUE_DB_PATH` to an absolute `apps/web/data/sim-queue.db`** so the API and worker always share one file even if their working directories differ.
2. Alternative split terminals:
   - Terminal A: `pnpm dev` (Next.js)
   - Terminal B: `pnpm sim:worker` — builds `@ip-sim/core` if needed, then runs `apps/web/scripts/sim-worker.ts` (polls SQLite)
3. In the lab, **Single run** → **Enqueue run** (heuristic or QRE only) opens the **Queue** tab; the worker picks jobs and writes results (JSON in DB up to ~2 MB, otherwise under `data/sim-results/`).
4. If the worker is down, the Queue tab now shows a warning banner after a short startup grace period (queued jobs with no active claims) with instructions to run `pnpm dev:all` / `pnpm sim:worker`.

Environment:

| Variable | Purpose |
|----------|---------|
| `SIM_QUEUE_DB_PATH` | Optional absolute path to the SQLite file (parent dir also holds `sim-results/` spillover). Set automatically by `pnpm dev:all`. |
| `SIM_WORKER_ENABLED` | Set to `0` or `false` to make the worker exit immediately (optional guard). |
| `SIM_WORKER_IDLE_LOG_MS` | Worker stdout heartbeat when the queue is empty (default `30000`; set `0` to disable). |

**Limitations:** queued runs use **TS `heuristicPolicy`**, not the Rust WASM path used in-browser for **Heuristic**. **LLM** is not queued (use **Run simulation** in the Single tab). `better-sqlite3` is a native addon — CI/server images must compile or prebuild it; serverless functions are a poor fit for the **worker** (use a long-lived Node service).

- **SQLite / `NODE_MODULE_VERSION` mismatch:** after cloning or upgrading Node, run `pnpm install` (root `postinstall` rebuilds `better-sqlite3`) or from the repo root `pnpm rebuild better-sqlite3` / `pnpm --filter web rebuild better-sqlite3`. On Windows, **EBUSY / EPERM** during rebuild usually means another process (e.g. `pnpm dev` or the sim worker) still has the native module loaded — stop it and retry.
- **Accidentally ran `npm install`:** stop running Node processes (`pnpm dev`, worker, stray `node.exe`) that may lock `better_sqlite3.node`, then run `pnpm install` from repo root to repair workspace links and native modules.

### Windows `node-gyp` troubleshooting (`better-sqlite3`)

If `pnpm install` or `pnpm setup:native` fails while building `better-sqlite3`, verify the native toolchain and do a clean reinstall:

```powershell
# 1) Confirm Python seen by npm/node-gyp
npm config get python
py --version

# 2) Ensure Visual Studio Build Tools 2022 includes:
#    - Desktop development with C++
#    - MSVC v143 build tools
#    - Windows 10/11 SDK

# 3) Stop processes that can lock better_sqlite3.node
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 4) Clean stale native artifacts/workspace install state
Remove-Item -Recurse -Force .\node_modules
Remove-Item -Recurse -Force .\apps\web\node_modules
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue

# 5) Reinstall with pnpm and rebuild native module
pnpm install
pnpm setup:native
```

If `npm config get python` is empty/invalid, set it explicitly (then rerun the clean reinstall):

```powershell
npm config set python "py"
```

### LLM mode (server-side key)

Create `apps/web/.env.local`:

```bash
OPENAI_API_KEY=sk-...
# Optional:
OPENAI_MODEL=gpt-4o-mini
```

Restart `pnpm dev`. LLM mode calls OpenAI once **per agent per tick** — increase cost quickly; reduce population/ticks for experiments.

### Population presets & replay

- **Population preset** (sidebar): Small (~24) → **Stress (~800)** agents with scaled market size. You can still edit per-type counts manually.
- **Replay**: after a run, use **Play / Pause / Reset**, speed (ticks/sec), and the scrubber — the network and metric cards follow the **playhead**, and charts show a **vertical cursor**.
- **Export WebM / GIF**: same **canvas replay** of the four metric sparklines. WebM uses `MediaRecorder`; GIF uses **gifenc** (256-color palette from frame 0). GIFs can get large on long runs — shorten ticks or lower implicit fps if needed.
- **Parameter grid**: batch sweep over **enforcement intensity × open-science subsidy** (Heuristic or QRE only). Click a row to load that run into the main viewer.

### Metrics definitions (v1)

- **Money concentration:** Gini on wealth; **top 10% wealth share** in charts.
- **Power concentration:** HHI over a composite score (market share + patents + degree share).
- **Innovation:** flow metric from R&D, publications, and collaboration knowledge increments each tick.

### Video export (Remotion)

1. Run a simulation in the web UI and **Download run JSON**.
2. Build props file containing only `{ "history": [ ... tick records from file ... ] }`.
3. From `packages/remotion`:

```bash
pnpm exec remotion render src/index.ts IpSimMetrics ../../out/metrics.mp4 --props=./my-run-props.json
```

Studio preview:

```bash
pnpm exec remotion studio src/index.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Next.js dev server |
| `pnpm dev:all` | Start Next.js dev server and sim worker together |
| `pnpm build` | Build `sim-core` + `web` |
| `pnpm sim:worker` | Long-lived worker: process queued sim jobs (SQLite + `@ip-sim/core`) |
| `pnpm test` | Vitest suite for `@ip-sim/core` (metrics, wealth / policy invariants, integration) |
| `pnpm test:all` | Run `test` scripts across workspace packages/apps (`--if-present` skips packages without a `test` script) |

## Literature notes

See [`research/`](research/) for background synthesis used during design.
