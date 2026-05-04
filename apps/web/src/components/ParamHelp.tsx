"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

const VIEW_MARGIN = 8;
const POINTER_CLOSE_MS = 150;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Question-mark control: hover or focus shows the full explanation in a portaled
 * tooltip (viewport-clamped width, wrapping, optional scroll for long copy).
 */
export function ParamHelp({ text }: { text: string }) {
  const baseId = useId();
  const tooltipId = `${baseId}-tooltip`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), POINTER_CLOSE_MS);
  }, [clearCloseTimer]);

  const openNow = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const positionTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return;

    const tr = trigger.getBoundingClientRect();
    const tt = tip.getBoundingClientRect();
    const m = VIEW_MARGIN;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = tr.bottom + m;
    let left = tr.left + tr.width / 2 - tt.width / 2;
    left = clamp(left, m, vw - tt.width - m);

    if (top + tt.height > vh - m) {
      const above = tr.top - tt.height - m;
      if (above >= m) top = above;
    }

    top = clamp(top, m, vh - tt.height - m);

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionTooltip();
    const onScrollOrResize = () => positionTooltip();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, text, positionTooltip]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const tooltip =
    open && typeof document !== "undefined" ? (
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-auto fixed z-[10000] box-border max-h-[min(50vh,22rem)] w-max max-w-[min(24rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-md border border-[var(--border)] bg-[#141418] px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-[var(--text)] shadow-lg [overflow-wrap:anywhere] [word-break:break-word]"
        onPointerEnter={clearCloseTimer}
        onPointerLeave={scheduleClose}
      >
        {text}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-[var(--border)] bg-[#1a1a1f] text-[10px] font-semibold leading-none text-[var(--muted)] hover:border-[var(--accent)]/60 hover:text-[var(--text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        aria-label={text}
        onPointerEnter={openNow}
        onPointerLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
      >
        ?
      </button>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}

/** Use beside parameter labels: label text + ? tooltip. */
export function FieldLabel({
  children,
  help,
  className = "",
}: {
  children: ReactNode;
  help: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span>{children}</span>
      <ParamHelp text={help} />
    </span>
  );
}
