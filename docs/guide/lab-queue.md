# Lab queue & worker

This repo supports an optional **local** job queue backed by SQLite so long-running runs can complete outside the browser.

Queued runs are processed by a **separate long-lived Node worker**. This is intentionally not “serverless-friendly”; treat it like a small background service you run locally during development.

## Start everything (recommended)

```bash
pnpm dev:all
```

This starts:

- Next.js dev server (web UI)
- Node worker process (`pnpm sim:worker`)

and sets `SIM_QUEUE_DB_PATH` to an absolute path so both processes share the same DB file.

## Split terminals (alternative)

- Terminal A:

```bash
pnpm dev
```

- Terminal B:

```bash
pnpm sim:worker
```

## Environment variables

- `SIM_QUEUE_DB_PATH`: optional absolute path to the SQLite DB file (its parent directory also holds `sim-results/` spillover files)
- `SIM_WORKER_ENABLED`: set `0`/`false` to disable the worker (it will exit immediately)
- `SIM_WORKER_IDLE_LOG_MS`: worker stdout heartbeat when the queue is empty (default `30000`; set `0` to disable)

## Where data is stored

- `apps/web/data/sim-queue.db`: SQLite job queue + lab session tables (default)
- `apps/web/data/sim-results/`: large JSON spillover for job results

The worker stores results in the DB up to roughly ~2MB; larger results are written under `sim-results/` and referenced by the DB.

## Limitations

- Queued runs use the TypeScript engine (`@ip-sim/core`) and the TS `heuristicPolicy` / QRE path.
- LLM-mode runs are not queued; run those directly in the Single-run UI.
- `better-sqlite3` is a native addon; if you hit install issues on Windows, see [Windows native setup](/guide/windows-native).


