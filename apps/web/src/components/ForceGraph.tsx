"use client";

import type { AgentState, Edge } from "@ip-sim/core";
import { computeForceLayout } from "@/lib/graphLayout";
import { subsampleGraphForLayout } from "@/lib/graphSample";
import { civicPrimaryPalette, civicVisualKey, nodeFillAndStroke } from "@/lib/graphStyle";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";

function agentTitle(a: AgentState, civicPrimary: boolean): string {
  const civic = civicVisualKey(a.civicRole, a.publicServantFireable);
  const civicLine = civicPrimary
    ? `civic ${civic.replace(/_/g, " ")}`
    : `civic ${a.civicRole}${a.civicRole === "public_servant" ? (a.publicServantFireable ? " (fireable)" : " (tenured)") : ""}`;
  return `${a.id} (${a.type}) · ${civicLine} · wealth ${a.wealth.toFixed(1)} · rep ${a.reputation.toFixed(2)} · click to toggle selection`;
}

export function ForceGraph(props: {
  agents: AgentState[];
  edges: Edge[];
  width: number;
  height: number;
  /** Used for deterministic subsampling when there are many agents. */
  layoutSeed?: number;
  /** Increment when a new run is loaded so previous node selections are cleared. */
  selectionResetEpoch?: number;
  /** Fires whenever the set of selected agent ids changes (including clear). */
  onSelectionChange?: (ids: readonly string[]) => void;
}) {
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;

  const notifySelection = useCallback((next: Set<string>) => {
    onSelectionChangeRef.current?.([...next].sort());
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const empty = new Set<string>();
      notifySelection(empty);
      return empty;
    });
  }, [notifySelection]);

  const toggleId = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        notifySelection(next);
        return next;
      });
    },
    [notifySelection],
  );

  useEffect(() => {
    setSelectedIds(new Set());
    onSelectionChangeRef.current?.([]);
  }, [props.selectionResetEpoch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  const sampled = useMemo(
    () =>
      subsampleGraphForLayout(
        props.agents,
        props.edges,
        props.layoutSeed ?? 0,
      ),
    [props.agents, props.edges, props.layoutSeed],
  );

  const civicPrimary = useMemo(
    () => civicPrimaryPalette(sampled.agents),
    [sampled.agents],
  );

  useEffect(() => {
    setPositions(
      computeForceLayout(
        sampled.agents,
        sampled.edges,
        props.width,
        props.height,
      ),
    );
  }, [sampled.agents, sampled.edges, props.width, props.height]);

  return (
    <>
      {sampled.sampled ? (
        <p className="mb-2 font-mono-n text-[11px] text-[var(--muted)]">
          Showing {sampled.agents.length} of {sampled.totalAgents} agents (sampled layout for speed).
        </p>
      ) : null}
      <svg
        width={props.width}
        height={props.height}
        className="rounded-md border border-[var(--border)] bg-[#0a0a0c]"
      >
        <rect
          width={props.width}
          height={props.height}
          fill="transparent"
          className="cursor-default"
          onClick={clearSelection}
        />
        <g>
          {sampled.edges.map((e, i) => {
            const pa = positions[e.a];
            const pb = positions[e.b];
            if (!pa || !pb) return null;
            return (
              <line
                key={`${e.a}-${e.b}-${i}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="#52525b"
                strokeOpacity={0.55}
                strokeWidth={Math.min(3, 0.4 + e.weight)}
                pointerEvents="none"
              />
            );
          })}
          {sampled.agents.map((a) => {
            const p = positions[a.id];
            if (!p) return null;
            const r = 6 + Math.sqrt(Math.max(0, a.wealth)) * 0.22;
            const sel = selectedIds.has(a.id);
            const { fill, stroke, strokeWidth } = nodeFillAndStroke(a, civicPrimary);
            return (
              <circle
                key={a.id}
                cx={p.x}
                cy={p.y}
                r={r}
                fill={fill}
                fillOpacity={0.92}
                stroke={sel ? "#fafafa" : stroke}
                strokeWidth={sel ? Math.max(2, r * 0.12) : strokeWidth}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleId(a.id);
                }}
              >
                <title>{agentTitle(a, civicPrimary)}</title>
              </circle>
            );
          })}
        </g>
      </svg>
    </>
  );
}
