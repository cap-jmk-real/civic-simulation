# Agent-based IP / information-sharing simulation

pnpm monorepo implementing a discrete-time ABM with heterogeneous actors (**bigco**, **academic**, **smb**, **solo**), institutional IP/data-sharing knobs, collaboration networks, and society metrics (**Gini**, **HHI**, **innovation flow**, composite **power**).

## Packages

| Package | Purpose |
|--------|---------|
| `@ip-sim/core` | Simulation engine, policies (heuristic, QRE), metrics, JSON export — **API: [packages/sim-core/API.md](packages/sim-core/API.md)** · **Model & math: [packages/sim-core/SIMULATION_MATH.md](packages/sim-core/SIMULATION_MATH.md)** |
| **`ip-sim-engine` (Rust)** | Native CLI/library + benchmarks — **[SCALING.md](packages/ip-sim-engine/SCALING.md)** · `pnpm rust:test` |
| **`@ip-sim/wasm`** | **Same market kernel** as `.wasm` — ships **prebuilt** in `pkg/` so users only need `pnpm install` (no Rust). Rebuild after Rust edits: `pnpm wasm:build` (needs `wasm-pack` + `wasm32-unknown-unknown`). |
| `web` | Next.js UI; lazy-loads WASM for optional compiled market math — **Download run JSON** |
| `@ip-sim/remotion` | Optional Remotion composition reading exported `history` for MP4 renders |

**Persistence:** runs are exported as JSON from the browser (no SQLite/Postgres in v1).

## Quick start

```bash
pnpm install
pnpm dev
```

End users do **not** install Rust or native binaries: the browser loads the packaged **`@ip-sim/wasm`** module from the repo (WebAssembly + JS glue).

Open [http://localhost:3000](http://localhost:3000). Choose **Heuristic** or **QRE** for fast runs; use **LLM** only with API keys configured.

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
| `pnpm build` | Build `sim-core` + `web` |
| `pnpm test` | Vitest suite for `@ip-sim/core` (metrics, wealth / policy invariants, integration) |

## Literature notes

See [`research/`](research/) for background synthesis used during design.
