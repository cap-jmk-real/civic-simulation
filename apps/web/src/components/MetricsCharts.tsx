"use client";

import type { TickRecord } from "@ip-sim/core";
import { stockDistribution } from "@ip-sim/core";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function repDistFromSnapshots(h: TickRecord) {
  const vals = h.agentSnapshots.map((a) => a.reputation ?? 0);
  return stockDistribution(vals);
}

function repMetric(
  h: TickRecord,
  key:
    | "totalReputation"
    | "top10Reputation"
    | "top1PercentReputation"
    | "giniReputation"
    | "top10ReputationShare",
): number | undefined {
  const v = (h.metrics as unknown as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function sumSnapshotReputation(t: TickRecord): number {
  return t.agentSnapshots.reduce((s, a) => s + (a.reputation ?? 0), 0);
}

function repGiniFromSnapshots(h: TickRecord): number {
  return repDistFromSnapshots(h).gini;
}

function repTop10ShareFromSnapshots(h: TickRecord): number {
  return repDistFromSnapshots(h).top10Share;
}

export function MetricsCharts(props: {
  history: TickRecord[];
  compareHistory?: TickRecord[];
  /** Step index (dataKey `t`) for live replay cursor. */
  playheadStep?: number;
}) {
  const data = props.history.map((h, i) => ({
    t: i,
    tickLabel: h.metrics.tick,
    totalWealth: Number((h.metrics.totalWealth ?? sumSnapshotWealth(h)).toFixed(2)),
    meanWealth: Number(
      (
        h.metrics.meanWealth ??
        (h.metrics.totalWealth ?? sumSnapshotWealth(h)) /
          Math.max(1, h.metrics.agentCount ?? h.agentSnapshots.length)
      ).toFixed(2),
    ),
    top10Wealth: Number((h.metrics.top10Wealth ?? 0).toFixed(2)),
    top1Wealth: Number((h.metrics.top1PercentWealth ?? 0).toFixed(2)),
    totalReputation: Number((repMetric(h, "totalReputation") ?? sumSnapshotReputation(h)).toFixed(3)),
    top10Reputation: Number(
      (repMetric(h, "top10Reputation") ?? repDistFromSnapshots(h).top10Sum).toFixed(3),
    ),
    top1Reputation: Number(
      (repMetric(h, "top1PercentReputation") ?? repDistFromSnapshots(h).top1Sum).toFixed(3),
    ),
    gini: Number(h.metrics.giniWealth.toFixed(4)),
    giniReputation: Number(
      (repMetric(h, "giniReputation") ?? repGiniFromSnapshots(h)).toFixed(4),
    ),
    powerHHI: Number(h.metrics.powerHHI.toFixed(4)),
    innovation: Number(h.metrics.innovationFlow.toFixed(3)),
    regulatoryStringency: Number(h.metrics.regulatoryStringency.toFixed(3)),
    regulatoryCorruption: Number(h.metrics.regulatoryCorruption.toFixed(3)),
    externalityNetLoad: Number(h.metrics.externalityNetLoad.toFixed(3)),
    wealthTop10: Number(h.metrics.top10WealthShare.toFixed(4)),
    repTop10: Number(
      (repMetric(h, "top10ReputationShare") ?? repTop10ShareFromSnapshots(h)).toFixed(4),
    ),
    totalWealthPrev: props.compareHistory?.[i]
      ? Number(
          (
            props.compareHistory[i]!.metrics.totalWealth ??
            sumSnapshotWealth(props.compareHistory[i]!)
          ).toFixed(2),
        )
      : undefined,
    meanWealthPrev: props.compareHistory?.[i]
      ? Number(
          (
            props.compareHistory[i]!.metrics.meanWealth ??
            (props.compareHistory[i]!.metrics.totalWealth ??
              sumSnapshotWealth(props.compareHistory[i]!)) /
              Math.max(
                1,
                props.compareHistory[i]!.metrics.agentCount ??
                  props.compareHistory[i]!.agentSnapshots.length,
              )
          ).toFixed(2),
        )
      : undefined,
    top10WealthPrev: props.compareHistory?.[i]
      ? Number((props.compareHistory[i]!.metrics.top10Wealth ?? 0).toFixed(2))
      : undefined,
    top1WealthPrev: props.compareHistory?.[i]
      ? Number((props.compareHistory[i]!.metrics.top1PercentWealth ?? 0).toFixed(2))
      : undefined,
    giniPrev: props.compareHistory?.[i]
      ? Number(props.compareHistory[i]!.metrics.giniWealth.toFixed(4))
      : undefined,
    powerPrev: props.compareHistory?.[i]
      ? Number(props.compareHistory[i]!.metrics.powerHHI.toFixed(4))
      : undefined,
    wealthTop10Prev: props.compareHistory?.[i]
      ? Number(props.compareHistory[i]!.metrics.top10WealthShare.toFixed(4))
      : undefined,
    innovationPrev: props.compareHistory?.[i]
      ? Number(props.compareHistory[i]!.metrics.innovationFlow.toFixed(3))
      : undefined,
    totalReputationPrev: props.compareHistory?.[i]
      ? Number(
          (
            repMetric(props.compareHistory[i]!, "totalReputation") ??
            sumSnapshotReputation(props.compareHistory[i]!)
          ).toFixed(3),
        )
      : undefined,
    top10ReputationPrev: props.compareHistory?.[i]
      ? Number(
          (
            repMetric(props.compareHistory[i]!, "top10Reputation") ??
            repDistFromSnapshots(props.compareHistory[i]!).top10Sum
          ).toFixed(3),
        )
      : undefined,
    top1ReputationPrev: props.compareHistory?.[i]
      ? Number(
          (
            repMetric(props.compareHistory[i]!, "top1PercentReputation") ??
            repDistFromSnapshots(props.compareHistory[i]!).top1Sum
          ).toFixed(3),
        )
      : undefined,
    giniReputationPrev: props.compareHistory?.[i]
      ? Number(
          (
            repMetric(props.compareHistory[i]!, "giniReputation") ??
            repGiniFromSnapshots(props.compareHistory[i]!)
          ).toFixed(4),
        )
      : undefined,
    repTop10Prev: props.compareHistory?.[i]
      ? Number(
          (
            repMetric(props.compareHistory[i]!, "top10ReputationShare") ??
            repTop10ShareFromSnapshots(props.compareHistory[i]!)
          ).toFixed(4),
        )
      : undefined,
  }));

  return (
    <div className="flex flex-col gap-3">
      <WealthLevelsChart
        data={data}
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <ReputationLevelsChart
        data={data}
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Gini (wealth concentration)"
        data={data}
        dataKey="gini"
        compareKey="giniPrev"
        stroke="#f472b6"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Gini (reputation concentration)"
        data={data}
        dataKey="giniReputation"
        compareKey="giniReputationPrev"
        stroke="#c4b5fd"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Top 10% reputation share"
        data={data}
        dataKey="repTop10"
        compareKey="repTop10Prev"
        stroke="#a78bfa"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Power HHI"
        data={data}
        dataKey="powerHHI"
        compareKey="powerPrev"
        stroke="#60a5fa"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Top 10% wealth share"
        data={data}
        dataKey="wealthTop10"
        compareKey="wealthTop10Prev"
        stroke="#34d399"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Mean wealth / agent (GDP-like level)"
        data={data}
        dataKey="meanWealth"
        compareKey="meanWealthPrev"
        stroke="#38bdf8"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Innovation flow (per tick)"
        data={data}
        dataKey="innovation"
        compareKey="innovationPrev"
        stroke="#fbbf24"
        hasCompare={!!props.compareHistory?.length}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Regulatory effective stringency"
        data={data}
        dataKey="regulatoryStringency"
        compareKey="regulatoryStringency"
        stroke="#94a3b8"
        hasCompare={false}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Institutional corruption"
        data={data}
        dataKey="regulatoryCorruption"
        compareKey="regulatoryCorruption"
        stroke="#f97316"
        hasCompare={false}
        playheadStep={props.playheadStep}
      />
      <MetricPanel
        title="Net externality load (pre-mitigation)"
        data={data}
        dataKey="externalityNetLoad"
        compareKey="externalityNetLoad"
        stroke="#22d3ee"
        hasCompare={false}
        playheadStep={props.playheadStep}
      />
      <p className="font-mono-n text-[11px] text-[var(--muted)]">
        X-axis: simulation step index · dashed line = previous run (when enabled)
      </p>
    </div>
  );
}

function sumSnapshotWealth(t: TickRecord): number {
  return t.agentSnapshots.reduce((s, a) => s + a.wealth, 0);
}

function WealthLevelsChart(props: {
  data: Array<Record<string, number | undefined>>;
  hasCompare: boolean;
  playheadStep?: number;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[#0a0a0c] p-2">
      <div className="mb-1 px-1 font-mono-n text-[11px] font-medium text-[var(--muted)]">
        Wealth (total · richest 10% · richest 1%)
      </div>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
            <XAxis dataKey="t" stroke="#6b7280" fontSize={10} tickLine={false} />
            <YAxis
              stroke="#6b7280"
              fontSize={10}
              domain={["auto", "auto"]}
              width={52}
              tickLine={false}
              tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v}`)}
            />
            <Tooltip
              contentStyle={{
                background: "#141418",
                border: "1px solid #2a2a32",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number | string) =>
                value != null && value !== "" ? Number(value).toFixed(1) : ""
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="totalWealth"
              name="Total"
              stroke="#e4e4e7"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="top10Wealth"
              name="Top 10% cohort"
              stroke="#34d399"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="top1Wealth"
              name="Top 1% cohort"
              stroke="#f97316"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            {props.hasCompare ? (
              <>
                <Line
                  type="monotone"
                  dataKey="totalWealthPrev"
                  name="Total (prev)"
                  stroke="#e4e4e7"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="top10WealthPrev"
                  name="Top 10% (prev)"
                  stroke="#34d399"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="top1WealthPrev"
                  name="Top 1% (prev)"
                  stroke="#f97316"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
              </>
            ) : null}
            {props.playheadStep !== undefined ? (
              <ReferenceLine
                x={props.playheadStep}
                stroke="#a1a1aa"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ReputationLevelsChart(props: {
  data: Array<Record<string, number | undefined>>;
  hasCompare: boolean;
  playheadStep?: number;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[#0a0a0c] p-2">
      <div className="mb-1 px-1 font-mono-n text-[11px] font-medium text-[var(--muted)]">
        Reputation stock (total · richest 10% · richest 1%)
      </div>
      <div className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
            <XAxis dataKey="t" stroke="#6b7280" fontSize={10} tickLine={false} />
            <YAxis
              stroke="#6b7280"
              fontSize={10}
              domain={["auto", "auto"]}
              width={52}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#141418",
                border: "1px solid #2a2a32",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number | string) =>
                value != null && value !== "" ? Number(value).toFixed(2) : ""
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="totalReputation"
              name="Total"
              stroke="#ddd6fe"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="top10Reputation"
              name="Top 10% cohort"
              stroke="#a78bfa"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="top1Reputation"
              name="Top 1% cohort"
              stroke="#7c3aed"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            {props.hasCompare ? (
              <>
                <Line
                  type="monotone"
                  dataKey="totalReputationPrev"
                  name="Total (prev)"
                  stroke="#ddd6fe"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="top10ReputationPrev"
                  name="Top 10% (prev)"
                  stroke="#a78bfa"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="top1ReputationPrev"
                  name="Top 1% (prev)"
                  stroke="#7c3aed"
                  dot={false}
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  opacity={0.45}
                  isAnimationActive={false}
                />
              </>
            ) : null}
            {props.playheadStep !== undefined ? (
              <ReferenceLine
                x={props.playheadStep}
                stroke="#a1a1aa"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MetricPanel<T extends Record<string, unknown>>(props: {
  title: string;
  data: T[];
  dataKey: keyof T & string;
  compareKey: keyof T & string;
  stroke: string;
  hasCompare: boolean;
  playheadStep?: number;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[#0a0a0c] p-2">
      <div className="mb-1 px-1 font-mono-n text-[11px] font-medium text-[var(--muted)]">
        {props.title}
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={props.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2a2a32" strokeDasharray="3 3" />
            <XAxis dataKey="t" stroke="#6b7280" fontSize={10} tickLine={false} />
            <YAxis
              stroke="#6b7280"
              fontSize={10}
              domain={["auto", "auto"]}
              width={44}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#141418",
                border: "1px solid #2a2a32",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value) =>
                value != null && value !== ""
                  ? Number(value).toFixed(4)
                  : ""
              }
            />
            <Line
              type="monotone"
              dataKey={props.dataKey}
              stroke={props.stroke}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            {props.hasCompare ? (
              <Line
                type="monotone"
                dataKey={props.compareKey}
                stroke={props.stroke}
                dot={false}
                strokeWidth={1}
                strokeDasharray="5 5"
                opacity={0.45}
                isAnimationActive={false}
              />
            ) : null}
            {props.playheadStep !== undefined ? (
              <ReferenceLine
                x={props.playheadStep}
                stroke="#a1a1aa"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
