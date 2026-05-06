# Metrics (v1)

The lab UI shows a small set of “headline” metrics intended to make regime comparisons quick.

## Money concentration

- **Gini (wealth)**: inequality of agent wealth.
- **Top 10% wealth share**: fraction of total wealth held by the top decile.

## Power concentration

- **HHI (power)**: Herfindahl–Hirschman Index computed over a composite power score.
- The composite score is based on (at least) market share, patents, and network centrality/degree share.

## Innovation

- A flow-style metric that aggregates innovation from R&D, publications, and knowledge increments from collaborations each tick.

## Where to look in code

- `packages/sim-core`: metric implementations and invariants/tests
- `apps/web`: charting + how the UI selects and renders metrics

