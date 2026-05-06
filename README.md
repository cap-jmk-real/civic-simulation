# Civic simulation (agent-based IP modelling)

<!-- shieldcn-start -->
[![CI](https://shieldcn.dev/github/ci/cap-jmk-real/civic-simulation.svg?variant=secondary&style=flat-square&labelColor=171717)](https://github.com/cap-jmk-real/civic-simulation/actions/workflows/ci.yml)
[![Docs](https://shieldcn.dev/badge/docs-GitHub_Pages-0ea5e9.svg?logo=readthedocs&variant=secondary&style=flat-square&labelColor=171717)](https://cap-jmk-real.github.io/civic-simulation/)
[![License](https://shieldcn.dev/github/license/cap-jmk-real/civic-simulation.svg?variant=secondary&style=flat-square&labelColor=171717&color=262626)](LICENSE)
[![pnpm](https://shieldcn.dev/badge/pnpm-9.14.2-F69220.svg?logo=pnpm&variant=branded&style=flat-square&labelColor=171717)](https://pnpm.io/)
[![Node](https://shieldcn.dev/badge/node-24-339933.svg?logo=node.js&variant=branded&style=flat-square&labelColor=171717)](https://nodejs.org/)
[![TypeScript](https://shieldcn.dev/badge/TypeScript-5.7-3178C6.svg?logo=typescript&variant=branded&style=flat-square&labelColor=171717)](https://www.typescriptlang.org/)
[![Next.js](https://shieldcn.dev/badge/Next.js-15-000000.svg?logo=next.js&variant=secondary&style=flat-square&labelColor=171717)](https://nextjs.org/)
[![Rust](https://shieldcn.dev/badge/Rust-stable-000000.svg?logo=rust&variant=secondary&style=flat-square&labelColor=171717)](https://www.rust-lang.org/)
[![WASM](https://shieldcn.dev/badge/WebAssembly-WASM-654FF0.svg?logo=webassembly&variant=secondary&style=flat-square&labelColor=171717)](https://webassembly.org/)
<!-- shieldcn-end -->

Discrete-time agent-based model (ABM) + a web “lab” UI for experimenting with IP/data-sharing regimes, collaboration networks, and distributional outcomes.

Badges are generated with [shieldcn](https://github.com/jal-co/shieldcn). To regenerate, run:

```bash
pnpm gen:shields
```

## Tech stack

- **Web UI**: Next.js + React (TypeScript)
- **Simulation core**: TypeScript package(s) in `packages/`
- **Engine**: Rust in `packages/ip-sim-engine/` (used for performance-critical simulation work)
- **WASM**: `packages/ip-sim-wasm/` builds a WebAssembly package (via `wasm-pack`) for browser-side execution

## Quickstart

Prereqs: **Node 24** and **pnpm** (this is a pnpm workspace; don’t use `npm install`).

```bash
pnpm install
pnpm dev:all
```

Open `http://localhost:3000`.

## Docs

- **Docs site (GitHub Pages)**: `https://cap-jmk-real.github.io/civic-simulation/`
- **Docs in-repo**: `docs/`
- **Key pages**:
  - `docs/guide/quickstart.md`
  - `docs/guide/lab-queue.md`
  - `docs/guide/troubleshooting.md`
  - `docs/guide/windows-native.md`
  - `docs/concepts/overview.md`

Run docs locally:

```bash
pnpm docs:dev
```

## CI

- **Actions**: https://github.com/cap-jmk-real/civic-simulation/actions
- **PR CI workflow**: https://github.com/cap-jmk-real/civic-simulation/actions/workflows/ci.yml

On pull requests, CI installs dependencies with pnpm, builds the TypeScript core, builds the Rust/WASM package (`wasm-pack`), builds docs, and runs lint/typecheck/tests for the web app (plus Rust tests on Linux).

