# Quickstart

## Install

```bash
pnpm install
```

## Run the web app + worker

```bash
pnpm dev:all
```

Open `http://localhost:3000`.

## Where the “Lab” data lives

- `apps/web/data/sim-queue.db` (SQLite job queue + lab session tables)
- `apps/web/data/sim-results/` (large JSON spillover for job results)

## Next reads

- [Lab queue & worker](/guide/lab-queue)
- [Troubleshooting](/guide/troubleshooting)
- [Windows native setup](/guide/windows-native)

