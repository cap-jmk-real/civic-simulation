# Civic simulation (agent-based IP modelling)

[![CI](https://img.shields.io/github/actions/workflow/status/cap-jmk-real/civic-simulation/ci.yml?style=flat-square&label=CI)](https://github.com/cap-jmk-real/civic-simulation/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0ea5e9?style=flat-square&logo=readthedocs&logoColor=white)](https://cap-jmk-real.github.io/civic-simulation/)
[![License](https://img.shields.io/github/license/cap-jmk-real/civic-simulation?style=flat-square)](https://github.com/cap-jmk-real/civic-simulation)
[![pnpm](https://img.shields.io/badge/pnpm-9.14.2-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![WASM](https://img.shields.io/badge/WebAssembly-WASM-654FF0?style=flat-square&logo=webassembly&logoColor=white)](https://webassembly.org/)

Discrete-time agent-based model (ABM) + a web “lab” UI for experimenting with IP/data-sharing regimes, collaboration networks, and distributional outcomes.

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

