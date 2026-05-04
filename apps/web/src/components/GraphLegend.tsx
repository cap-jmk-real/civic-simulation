"use client";

import type { AgentState } from "@ip-sim/core";
import {
  CIVIC_FILL,
  ECONOMIC_FILL,
  useCivicPrimaryPalette,
} from "@/lib/graphStyle";

export function GraphLegend(props: { agents: AgentState[] }) {
  const civicPrimary = useCivicPrimaryPalette(props.agents);

  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[#0a0a0c] p-3 font-mono-n text-[11px] leading-snug text-[var(--muted)]">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[#9ca3af]">
        Graph encoding
      </div>
      {civicPrimary ? (
        <>
          <p className="mb-2 text-[10px] text-[var(--muted)]">
            Fill = civic role (governance on). Outline = economic actor type.
          </p>
          <ul className="mb-2 grid gap-1.5 sm:grid-cols-2">
            <LegendRow color={CIVIC_FILL.politician} label="Politician" />
            <LegendRow color={CIVIC_FILL.servant_fireable} label="Public servant (fireable)" />
            <LegendRow color={CIVIC_FILL.servant_tenured} label="Public servant (tenured)" />
            <LegendRow color={CIVIC_FILL.citizen} label="Citizen" />
          </ul>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#9ca3af]">
            Outline · type
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <LegendRow color={ECONOMIC_FILL.bigco} label="Bigco" />
            <LegendRow color={ECONOMIC_FILL.academic} label="Academic" />
            <LegendRow color={ECONOMIC_FILL.smb} label="SMB" />
            <LegendRow color={ECONOMIC_FILL.solo} label="Solo" />
          </ul>
        </>
      ) : (
        <>
          <p className="mb-2 text-[10px] text-[var(--muted)]">
            Fill = economic actor type. With governance and office-holders, fills switch to civic
            roles and types move to outlines.
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            <LegendRow color={ECONOMIC_FILL.bigco} label="Bigco" />
            <LegendRow color={ECONOMIC_FILL.academic} label="Academic" />
            <LegendRow color={ECONOMIC_FILL.smb} label="SMB" />
            <LegendRow color={ECONOMIC_FILL.solo} label="Solo" />
          </ul>
        </>
      )}
      <p className="mt-2 border-t border-[var(--border)] pt-2 text-[10px]">
        Node radius scales with wealth. Edge thickness scales with collaboration edge weight.
      </p>
    </div>
  );
}

function LegendRow(props: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--border)]"
        style={{ backgroundColor: props.color }}
        aria-hidden
      />
      <span className="text-[#d4d4d8]">{props.label}</span>
    </li>
  );
}
