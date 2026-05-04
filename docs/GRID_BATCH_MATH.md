# Parameter grid & batch construction (web UI)

This document describes **how** `apps/web` builds batch runs: the sweep table, discrete levels, construction modes (factorial, Monte Carlo, LHS, OAT), RNG seeding, and caps. The **engine tick math** (markets, IP, regulation) lives in `packages/sim-core/SIMULATION_MATH.md` and the Rust port `packages/ip-sim-engine`; the grid only **patches `SimConfig` / manifest** per cell.

**Source of truth (code):** `apps/web/src/lib/gridAxes.ts` (`buildGridConstructionPlan`, `sampleAxisValuesWithBounds`, `applyMultipleAxesToCell`, …) and `apps/web/src/components/BatchGridPanel.tsx` (UI, caps, cohort override).

---

## 1. Parameter catalog (what can be swept)

- Every row comes from **`GRID_AXIS_DEFINITIONS`** in `gridAxes.ts`, built from **`META`** + `GRID_AXIS_DESCRIPTIONS`.
- Axes mirror **Run configuration** fields (seed, ticks, agent counts, policy sliders, regulation toggles, spawn, R&D, depreciation, `ui.policyMode`, `manifest.qreTemperature`, …)—not hidden engine-only constants.
- Each axis has a **`GridSweep`**: `linear`, `linear_int`, or `enum`. Human-readable copy for tooltips lives in **`GRID_AXIS_DESCRIPTIONS`**.

---

## 2. Sweep table → discrete levels (`specs`)

For each **enabled** axis, the UI stores `min`, `max`, `steps` (except enums, where min/max are unused).

**`sampleAxisValuesWithBounds(def, steps, bounds)`**

| Sweep kind | Levels produced |
|------------|-----------------|
| **`enum`** | Let \(L\) = full enum length, \(k = \min(L, \max(1, \mathrm{round}(\texttt{steps})))\). If \(k \ge L\), all values. Else **`subsampleEnumValues`**: indices \(\mathrm{round}\bigl(j \cdot (L-1) / \max(1, k-1)\bigr)\) for \(j = 0 \ldots k-1\), sorted unique, then map to enum strings. |
| **`linear_int`** | **`linspaceInt(lo, hi, st)`**: integers from `round`ed evenly spaced points in \([lo, hi]\), duplicates removed, sorted; `st` clamped to \([2, \texttt{GRID\_MAX\_STEPS\_PER\_AXIS}]\). |
| **`linear`** | **`linspace(lo, hi, st)`**: \(x_i = lo + \frac{i}{st-1}(hi-lo)\) for \(i = 0 \ldots st-1\) (or single point if \(st < 2\)). |

**Default bounds** when the table is reset from the sidebar use **`deriveDefaultNumericBounds`** / per-axis **`customSample`** where defined (e.g. counts or ticks spread around the current config). User-edited min/max override those for sampling.

The batch runner always uses **explicit table bounds** for numeric axes in the construction plan (not live `customSample` re-evaluation at draw time for random/LHS—levels are fixed in `specs` first).

---

## 3. Automatic resolution hint (`autoSweepPointsPerAxis`)

Default **steps** suggestion (before user edits):

\[
\texttt{autoSteps} = \mathrm{clamp}\Bigl(2,\ 16,\ \mathrm{round}\bigl(480 / \max(1,\ N_{\mathrm{cohort}})^{0.55}\bigr)\Bigr)
\]

where \(N_{\mathrm{cohort}} = \sum \texttt{agentCounts}\) and the cap also considers **`spawn.maxAgents`** in the UI copy (“resolution scale”). Larger populations → fewer default points per axis to keep factorials tractable.

---

## 4. Construction modes (`buildGridConstructionPlan`)

Let enabled axes produce specs \(S_0,\ldots,S_{d-1}\) with level lists \(V_j\) of lengths \(L_j = |V_j|\).

### 4.1 Full factorial

- **Assignments:** Cartesian product \(\prod_j V_j\).
- **Runs:** \(\prod_j L_j\).
- **Heatmap:** Only when **exactly two** axes are enabled (first two in definition order define rows × columns).

### 4.2 Random sample (Monte Carlo)

- **Runs:** \(N = \min(\texttt{GRID\_ABS\_MAX\_RUNS}, \max(1, \lfloor\texttt{sampleRunCount}\rfloor))\), then clamped to user **max runs** cap in the panel. In the UI, **“Use max runs cap as sample size”** (on by default) sets the effective sample count to the **max runs budget** so the batch is not stuck at the separate 120 default—each run still draws **all enabled axes jointly**.
- For each run index \(i = 0 \ldots N-1\), axis \(j\): draw \(U \sim \mathrm{Uniform}(0,1)\) from **`mulberry32(batchDrawSeed(baseSeed, \texttt{random\_sample}, i, 0))`**.
- **Mapping:** **`unitToAxisValue`**: enums use \(\lfloor U \cdot L \rfloor\); `linear` uses \(lo + U(hi-lo)\); `linear_int` uses \(\mathrm{round}(lo + U(hi-lo))\) with \(U\) capped below 1 to avoid fencepost overflow.

### 4.3 Latin hypercube (LHS)

Classic **stratified sampling on \([0,1)^d\)** (McKay, Beckman, Conover, 1979), simplified for the UI:

1. Build an \(N \times d\) matrix of unit coordinates. For each column \(j\), draw a **random permutation** \(\pi_j\) of \(\{0,\ldots,N-1\}\) and independent \(U_{ij} \sim \mathrm{Unif}(0,1)\) from a setup RNG `mulberry32(batchDrawSeed(baseSeed, latin_hypercube, 0, 0x51ed))`.
2. Set \(U^{\mathrm{strat}}_{ij} = (\pi_j(i) + U_{ij}) / N\) so each axis margin is one draw per stratum \([k/N, (k+1)/N)\).
3. **Row shuffle:** permute row indices with another RNG stream so pairings are less structured.
4. Map each \(U^{\mathrm{strat}}_{ij}\) through **`unitToAxisValue`** with the same bounds as the table (as in §2).

### 4.4 One-at-a-time (OAT)

- **Baseline:** for each axis, pick the value at **mid index** \(\lfloor (L_j-1)/2 \rfloor\) in \(V_j\).
- For each axis \(a\), emit **one row per** \(v \in V_a\): axis \(a\) takes \(v\); all other axes stay at baseline.
- **Runs:** \(\sum_j L_j\) (not a product). **Fit to max runs** uses a greedy reduction on level counts (`adaptAxisTableToOatSumCap`).

---

## 5. Reproducibility & seeds

- **`mulberry32`:** 32-bit state update; output in \([0,1)\). Intended to match the core engine’s PRNG style for deterministic batches.
- **`batchDrawSeed(baseSeed, mode, runIndex, salt)`:** mixes `baseSeed`, mode index, run index, and optional salt with fixed XOR constants so different modes/indices/salts produce independent streams.

Run configuration **`config.seed`** is the **batch base seed** (same as Run sidebar).

---

## 6. Caps & cohort override (UI)

- **`GRID_WARN_TOTAL_RUNS`:** confirm before starting larger batches.
- **`GRID_ABS_MAX_RUNS`:** hard ceiling on factorial product or effective sample count paths.
- User **max runs** and **max agents** (optional) further filter or block plans; **Fit to max runs** adjusts steps (factorial), sample count (random/LHS), or OAT level counts.
- **Planned total N:** cohort rescale for the batch baseline (Hamilton / percentages—see `ParamHelp` in `BatchGridPanel` and `percentPopulation` helpers).

---

## 7. Applying a cell to the engine

**`applyMultipleAxesToCell(base, manifest0, assignments)`** walks assignments in order:

- `ui.policyMode` → manifest `policyMode`.
- `manifest.qreTemperature` → manifest field.
- All other ids → **`applyGridAxisValue`** on a cloned `SimConfig` (nested objects copied shallowly where needed).

Heuristic runs use Rust WASM; QRE still uses the TypeScript engine from `@ip-sim/core`—independent of how the grid chose parameter points.

---

## 8. What is *not* covered here

- **Fractional factorials**, **Sobol/QMC** sequences, **D-optimal** designs: not implemented (v1); only the four modes above.
- **LLM** policy batches: disabled in the grid UI.
- **Rust `ip-sim-engine`** coverage of every branch: parity is test-driven; see `packages/ip-sim-engine/tests/`.

If you change sampling or seeds, update **this file** and the block comment on **`GRID_CONSTRUCTION_MODES`** in `gridAxes.ts` together.
