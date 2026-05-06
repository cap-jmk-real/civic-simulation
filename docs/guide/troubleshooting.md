# Troubleshooting

## The queue has jobs but nothing runs

- Start the worker:

```bash
pnpm dev:all
```

or in a separate terminal:

```bash
pnpm sim:worker
```

The Queue UI will warn if jobs are queued but no active claims are observed after a short grace period.

## SQLite / `NODE_MODULE_VERSION` mismatch (`better-sqlite3`)

After cloning or upgrading Node, the simplest fix is:

```bash
pnpm install
```

If you still see a mismatch:

```bash
pnpm setup:native
```

## `EBUSY` / `EPERM` during `better-sqlite3` rebuild (Windows)

Another Node process likely still has the native module loaded (for example `pnpm dev` or the worker).

- Stop running Node processes, then rerun:

```bash
pnpm setup:native
```

## “I accidentally ran `npm install`”

This repo is a pnpm workspace; `npm install` can leave workspace packages and native deps in a broken state.

- Stop running Node processes (they can keep files locked on Windows)
- From the repo root run:

```bash
pnpm install
```

