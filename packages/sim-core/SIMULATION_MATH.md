# Simulation model — structure, relations, and mathematics

This document specifies **what each atomic module computes**, **how quantities relate**, and **where they appear** in [`applyStep`](src/engine.ts) and [`computeTickMetrics`](src/metrics.ts). It is the semantic counterpart to [`API.md`](API.md) (symbol-level reference).

---

## 1. Time and ordering

The simulation advances in **ticks**. One tick of [`applyStep`](src/engine.ts) applies the following **phases in order** (later phases see state updated by earlier ones):

1. **Delayed R&D delivery** — pipeline entries with `deliverOnTick === world.tick` add knowledge and contribute to `innovationFlow`.
2. **Actions** — each agent’s action runs (cash, knowledge, patents, pool, pairings, bribes, **spawn_agent**, …).
3. **Collaboration pairing** — shuffled list of `collaborate` actors; consecutive pairs share knowledge and rep.
4. **Trade pairing** — shuffled `trade` actors with an existing edge; wealth transfer only if both exist.
5. **Academic stipend** — wealth add for `type === "academic"`.
6. **Market revenue** — default **edge-logit** demand on the interaction graph (§5.4); optional **contest legacy** (§5.3) → base revenue → wealth / CES reputation effects (§5.5).
7. **Regulatory externality** (optional) — social load from goods/services qualities → wealth/reputation redistribution.
8. **Regulatory stringency update** — `advanceRegulatoryStringency` (fixed or dynamic).
9. **Wealth & knowledge depreciation** — proportional factors on stocks.
10. **Market size growth** — `marketSize += marketGrowthPerTick`.
11. **Patent expiry filter** — drop expired patent ticks relative to next tick index.
12. **Tick index & pool decay** — `world.tick += 1`, `globalPool *= 0.995`.

[`computeTickMetrics`](src/metrics.ts) runs **after** `applyStep` in the runner; it reads **post-step** `WorldState` plus the `innovationFlow` scalar returned by `applyStep`.

---

## 2. Randomness ([`rng.ts`](src/rng.ts))

- **`mulberry32(seed)`** — deterministic PRNG; `rnd()` ∈ **[0, 1)**. Same `seed` ⇒ same stream (used for reproducibility).
- **`shuffleInPlace(arr, rnd)`** — Fisher–Yates; **permutes** `arr` in place (uniform over permutations if `rnd` is uniform).

**Relation:** `runSimulationSync` / `runSimulationAsync` derive per-tick RNGs from `config.seed`, step index, and `world.tick`; policies may use separate streams (e.g. QRE).

---

## 3. Initial graph ([`graph.ts`](src/graph.ts))

Input: agent ids, [`GraphPreset`](src/types.ts) (`kind`, `avgDegree`), `rnd`.

- **`targetDeg`** = `clamp( floor(avgDegree), 1, n-1 )`.
- **Edge weight** when created: **Uniform[0.4, 1.0)** via `0.4 + rnd() * 0.6`.
- **`random`:** sample random pairs until **at least** `m = floor(n * targetDeg / 2)` edges (attempt cap `3m`).
- **`small_world`:** ring with offsets 1…`min(2,targetDeg)` on a **shuffled** ring order; optional rewires with probability `0.08`.
- **`scale_free`:** simplified preferential attachment + fallback edge.

**Metrics relation:** edges feed [`neighborCounts`](src/metrics.ts) (degree) and [`spilloverFromGraph`](src/metrics.ts) inside [`computeMarketShares`](src/metrics.ts).

---

## 4. Production & offering quality ([`production.ts`](src/production.ts))

### 4.1 Labor split

For agent type \(t\), **`serviceLaborShare(t)`** ∈ (0,1) maps labor into **services** vs **goods**:

- \(L_s = L \cdot s_t\), \(L_g = L \cdot (1 - s_t)\).

### 4.2 CES branch quality

For branch \(b \in \{g,s\}\):

\[
q_b = \text{cesAggregate}(K, L_b, \alpha_K, \rho, S)
\]

with **CES**:

\[
\text{cesAggregate} = A \cdot \left[ \alpha K^{\rho} + (1-\alpha) L^{\rho} \right]^{1/\rho}
\]

with \(|\rho| \ll 1\) approximating Cobb–Douglas (implementation uses small |\rho| branch).

### 4.3 Blended offering quality

With **`cesMixGoods`** \(m \in [0,1]\):

\[
q = m \cdot q_{\text{goods}} + (1-m) \cdot q_{\text{services}}.
\]

If CES is disabled in config, **`offeringQuality`** = 1 and **`offeringQualityBranches`** returns \((1,1,1)\).

**Engine relation:** \(q\) drives CES revenue multiplier and reputation deltas (§5.5); \((q_g, q_s)\) drive [**regulatory load**](#8-regulatory-model-regulatoryts) (§8).

---

## 5. Competitive weights and market revenue ([`metrics.ts`](src/metrics.ts) + [`demand.ts`](src/demand.ts) + [`engine.ts`](src/engine.ts))

### 5.1 Graph spillover for agent \(i\)

Let \(\mathcal{N}(i)\) be neighbors with edge weights \(w_{ij}\).

\[
\text{spill}_i = \alpha_{\text{spill}} \sum_{j \in \mathcal{N}(i)} w_{ij}\, K_j
\]

### 5.2 Raw competitive weight

Let \(\tau_a\) be type weight, \(\beta\) capability exponent, \(d_i\) degree, \(P_i\) patent count, \(R_i\) reputation.

\[
W_i = \tau_{t_i} \cdot (K_i + \text{spill}_i)^{\beta} \cdot (1 + 0.12 P_i) \cdot (1 + 0.05 R_i) \cdot (1 + 0.02 d_i)
\]

(clamped below by `1e-6`).

### 5.3 Contest revenue share

With \(S = \sum_i W_i\), agent \(i\)’s **pool share** is \(W_i / S\).

**Base revenue** (before CES quality scaling):

\[
\text{baseRev}_i = \frac{W_i}{S} \cdot M + \text{license}_i
\]

where \(M =\) `marketSize`, and

- \(\text{license}_i = P_i \cdot U[5,9) \cdot \text{regimeMult}\) if patents allowed, else `0`.
- If patent regime is **`none`**, base revenue is scaled by **`0.92 + globalPool * 0.0015`**.

\(\text{revBar} = \frac{1}{n}\sum_i \text{baseRev}_i\) (mean base revenue).

### 5.4 Edge-logit demand (default: `demandModel: "edge_logit"`)

[`computeBaseRevenues`](src/demand.ts) implements **Level B**: spending is **local on the graph**, not only a single global contest.

1. **Contest weights** \(W_i\) and \(S = \sum_i W_i\) are computed as in §5.2 (same as before).
2. **Buyer budget** (nominal): \(B_i = M \cdot W_i / S\) with \(M =\) `marketSize`. Hence \(\sum_i B_i = M\).
3. **Choice set** for buyer \(i\): \(\{i\} \cup \mathcal{N}(i)\) (always include **self** as “internal” demand; neighbors from undirected edges).
4. **Utility** for candidate supplier \(j\) (including \(j=i\)):

\[
U_{ij} = u_q \ln(q_j+\varepsilon) + u_R R_j + u_K \ln(K_j+\varepsilon)
\]

then, if \(j \neq i\), multiply by **`1 + w_{ij} \cdot \texttt{edgeLogitEdgeWeightScale}`** using the edge weight \(w_{ij}\) toward that neighbor.

Optional **preference noise**: add \(\texttt{edgeLogitPreferenceNoise} \cdot U(-1,1)\) (uniform) to each \(U_{ij}\) before the softmax.

5. **Softmax** over the choice set with temperature \(\tau =\) `edgeLogitTemperature`:

\[
p_{ij} = \frac{\exp(U_{ij}/\tau)}{\sum_{k \in \{i\}\cup\mathcal{N}(i)} \exp(U_{ik}/\tau)}.
\]

6. **Directed spend** from \(i\) to \(j\): \(x_{ij} = B_i \, p_{ij}\). **Incoming market revenue** (before licenses): \(R_j^{\text{net}} = \sum_i x_{ij}\). Then **licenses** and the **patent-regime-none** multiplier are applied per agent exactly as in §5.3 to obtain \(\text{baseRev}_j\).

**Conservation:** \(\sum_j R_j^{\text{net}} = \sum_i B_i = M\). Licenses and the `none`-regime factor are layered on top (same rules as legacy).

**Legacy switch:** `demandModel: "contest_legacy"` skips steps 3–6 and sets \(\text{baseRev}_i\) from §5.3 only.

### 5.5 CES revenue and reputation (when enabled)

- \(\bar q = \frac{1}{n}\sum_i q_i\), \(\text{relQ}_i = q_i / \bar q\) (or 1 if \(\bar q \approx 0\)).

\[
\text{revenue}_i = \text{baseRev}_i \cdot \operatorname{clamp}\bigl(1 + \gamma_{\text{rev}}(\text{relQ}_i - 1),\,0.45,\,1.85\bigr).
\]

Reputation adds (clamped) terms:

- \(\Delta R_{q,i} = \text{clamp}(\eta_q (\text{relQ}_i - 1), \ldots)\)
- \(\Delta R_{s,i} = \text{clamp}(\eta_s (\text{baseRev}_i/\text{revBar} - 1), \ldots)\)

**Profit** equals **revenue** this tick; wealth += profit; `lastProfit` = profit.

---

## 6. Policy-driven action algebra (selected)

Constants below match [`engine.ts`](src/engine.ts).

| Action | Main cash / knowledge / pool effects |
|--------|--------------------------------------|
| **invest_rnd** | Cost `investRndBase + U(0,span) + perK·K`; gain \(U(4,14)\)·(1.15 if bigco); optional delay queue |
| **publish_open** | Cost `4·(1 - 0.5·openScienceSubsidy)`; pool += \(K · U(0.06,0.14)·\text{spillMult}\); rep += \(U(0.08,0.13)\); neighbors get fraction of pool along edges |
| **file_patent** | Cost 8/14/22 by regime; patent expiry entries; small knowledge bump |
| **collaborate** | −2.5 wealth |
| **trade** | −1 wealth (paired phase later) |
| **enforce_ip** | Cost scales with litigation multiplier and enforcement; stochastic wealth transfer if patents exist elsewhere |
| **bribe_regulator** | See §9 |
| **spawn_agent** | If `spawn.enabled` and `n < maxAgents` and parent wealth ≥ `parentCostWealth + minParentWealthFloor`: pay cost, append new [`AgentState`](src/types.ts) (type from `childType` or inherit), set child wealth/knowledge/reputation, optional parent–child edge, bump `innovationFlow`; else memory-only no-op |

**Spill multiplier for publish:** \(\text{spillMult} = 1 + 0.25\cdot\text{dataSharingMandateStrength} + 0.2\cdot\text{openScienceSubsidy}\).

---

## 7. Collaboration & trade (pairing)

- **Collaboration:** random matching of collaborators; each pair with knowledge \(K_x,K_y\) shares pool \(\Delta K = 0.05(K_x+K_y)\), each gets \(0.45\Delta K\); `innovationFlow` includes \(0.9\Delta K\); rep +0.02 each; edge added/strengthened.
- **Trade:** requires existing edge; transfer \(p = \min(12, \max(0, \min(w_x,w_y)\cdot 0.04\cdot(0.35 + w_{xy}\cdot 0.25)))\) from richer to poorer agent.

---

## 8. Regulatory model ([`regulatory.ts`](src/regulatory.ts) + engine)

### 8.1 Channel loads

For each agent \(i\) with branch qualities \((q^g_i, q^s_i)\) and type \(t_i\):

\[
G = \sum_i q^g_i \cdot \gamma_{t_i},\qquad
S = \sum_i q^s_i \cdot \sigma_{t_i},\qquad
L = G + S
\]

where \(\gamma,\sigma\) are **`goodsExternalityByProducer`** / **`servicesExternalityByProducer`** (signed).

### 8.2 Mitigation of harm

Let \(E\) be effective mitigation stringency (`mitigationBaselineStringency` — **fixed** recomputes from ambition and corruption; **dynamic** uses stored stringency × erosion).

If \(L > 0\):

\[
L^{\*} = L \cdot \bigl(1 - \min(1,\, E \cdot \eta_{\text{mit}})\bigr).
\]

If \(L \le 0\), \(L^{\*} = L\) (no mitigation of “benefits”).

### 8.3 Allocation

Exposure weights \(v(t)\) = **`victimVulnerability`**; \(V = \sum_i v(t_i)\).

Per-agent **wealth** change from regulation:

\[
\Delta w_i = - L^{\*} \cdot \omega \cdot \frac{v(t_i)}{V}
\]

with \(\omega =\) `externalityWealthScale`. **Reputation** change:

\[
\Delta r_i = \Delta w_i \cdot \rho
\]

with \(\rho =\) `externalityReputationScale`, then clamped nonnegative on reputation stock.

**Tick metrics:** `externalityNetLoad` = \(L\), `externalityMitigatedLoad` = \(L^{\*}\), `regulatoryStringency` stores the \(E\) recorded for mitigation, `regulatoryCorruption` = world corruption stock.

### 8.4 Stringency dynamics

- **Fixed:** stringency each tick set to  
  \(\operatorname{clamp}_{[0,1]}\bigl(b\cdot(0.2 + 0.8 a)\cdot \pi \cdot (1 - c\cdot\varepsilon)\bigr)\)  
  with \(b=\) `baseStringency`, \(a=\) `regulatoryAmbition`, \(\pi=\) `policyScale`, \(c=\) corruption, \(\varepsilon=\) `corruptionErodesStringency`.

- **Dynamic:** AR(1)-style update toward attractor (same product as above) plus uniform noise width `dynamicNoise`, persistence `dynamicPersistence`.

---

## 9. Bribery

When **`bribe_regulator`** and regulation + bribe enabled:

1. Pay **`baseCost`**.
2. Detection probability **`pDet`** starts from `detectionProbability`, scaled by corruption (higher corruption **lowers** detection if `corruptionReducesDetection`).
3. If detected: subtract **`penaltyWealth`**, **`penaltyReputation`**, **`penaltyKnowledge`**.
4. Else: **`corruption += corruptionDelta`** (clamped to [0,1]).

---

## 10. Distribution metrics ([`metrics.ts`](src/metrics.ts))

- **Gini** — standard discrete formula on sorted nonnegative values; NaNs dropped; all-zero sum ⇒ 0.
- **HHI** — \(\sum_k (x_k / \sum x)^2\) on nonnegative weights.
- **`stockDistribution`** — total; top **count-based** 10% and 1% sums by **value rank**; Gini on raw values; top10Share = top10Sum/total.

**Power index:** composite score \(0.45\cdot ms_i + 0.35\cdot ppat_i + 0.2\cdot pdeg_i\) (normalized shares), then HHI over agents.

**Relation to stocks:** `TickMetrics` wealth block matches **current agent wealth**; reputation block matches **reputation** stocks; `innovationFlow` is the scalar passed from `applyStep`. **`agentCount`** is `world.agents.length` after the tick’s updates (so spawns within the action phase are visible in the same tick’s metrics snapshot taken at record time — the runner snapshots **after** `applyStep`).

---

## 11. Configuration merges ([`defaultConfig.ts`](src/defaultConfig.ts))

[`mergeSimConfig`](src/defaultConfig.ts) deep-merges **`policy`**, **`agentCounts`**, **`typeWeights`**, **`graph`**, and **`regulatory`** (including nested **`bribe`** and per-type externality maps). Partial saved configs therefore stay valid.

---

## 12. Observation bridge ([`observe.ts`](src/observe.ts))

[`buildObservation`](src/observe.ts) is a **read-only projection** of agent + world for policies: no simulation semantics added; **`regulatory.effectiveStringency`** uses the same erosion formula as §8 for the UI/policy context.

---

## 13. Test coverage map

| Module | Isolated tests | Role |
|--------|----------------|------|
| [`rng.ts`](src/rng.ts) | [`rng.test.ts`](src/rng.test.ts) | Determinism, shuffle permutation |
| [`memory.ts`](src/memory.ts) | [`memory.test.ts`](src/memory.test.ts) | FIFO cap + decay filter |
| [`regulatory.ts`](src/regulatory.ts) | [`regulatory.test.ts`](src/regulatory.test.ts) | Loads, mitigation, stringency advance |
| [`graph.ts`](src/graph.ts) | [`graph.test.ts`](src/graph.test.ts) | Edge sanity, determinism |
| [`export.ts`](src/export.ts) | [`export.test.ts`](src/export.test.ts) | JSON round-trip |
| [`observe.ts`](src/observe.ts) | [`observe.test.ts`](src/observe.test.ts) | Observation shape / regulatory snapshot |
| [`defaultConfig.ts`](src/defaultConfig.ts) | [`defaultConfig.test.ts`](src/defaultConfig.test.ts) | Merge semantics |
| [`production.ts`](src/production.ts) | [`production.test.ts`](src/production.test.ts) | CES & labor split |
| [`metrics.ts`](src/metrics.ts) | [`metrics.test.ts`](src/metrics.test.ts) | Gini, HHI, distributions, aggregates |
| [`policies/*.ts`](src/policies/) | [`policies/policies.test.ts`](src/policies/policies.test.ts) | Every policy output ∈ `ACTIONS` |
| [`engine.ts`](src/engine.ts) | `engine.*.test.ts`, [`engine.spawn.test.ts`](src/engine.spawn.test.ts), [`integration`](src/engine.integration.test.ts) | End-to-end contracts |

---

## See also

- [`API.md`](API.md) — exported symbols and parameters  
- [`src/types.ts`](src/types.ts) — serialized shapes  
- Vitest files above — executable specifications for atomic behavior  
- **Web batch / parameter grid** (how joint configs are *chosen* before calling this engine): [`../../docs/GRID_BATCH_MATH.md`](../../docs/GRID_BATCH_MATH.md) — factorial, Monte Carlo, LHS, OAT, seeds, and sweep-table math live there, not in this tick-level document.
