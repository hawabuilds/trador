"use client";

import {useMemo, useState} from "react";

import {
  actualWeights,
  groupSmallSlices,
  type DriftSlice,
} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import {compactMoney} from "@/lib/format";
import type {Holding} from "@/lib/types";

const SLICE_COLORS = [
  "var(--brand-500)",
  "#6B9FE8",
  "#E07A7A",
  "#6BCB94",
  "#E8B86D",
  "#A78BFA",
  "#67C9C3",
  "#F08BBE",
] as const;

function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad)};
}

function donutArc(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startDeg: number,
  endDeg: number,
): string {
  if (endDeg - startDeg >= 359.99) {
    endDeg = startDeg + 359.99;
  }
  const large = endDeg - startDeg > 180 ? 1 : 0;
  const startOuter = polar(cx, cy, outer, startDeg);
  const endOuter = polar(cx, cy, outer, endDeg);
  const startInner = polar(cx, cy, inner, endDeg);
  const endInner = polar(cx, cy, inner, startDeg);
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

export function AllocationChart({
  holdings,
  targets,
  driftRows,
  targetsActive = false,
  showTargetsHint = false,
  className,
  height = 168,
}: {
  holdings: readonly Holding[];
  targets: Record<string, number>;
  driftRows?: readonly DriftSlice[];
  /** True once saved targets sum to 100% — then legend shows actual / target. */
  targetsActive?: boolean;
  /** Hint under the legend when targets are not set yet. */
  showTargetsHint?: boolean;
  className?: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  const slices = useMemo(() => groupSmallSlices(actualWeights(holdings)), [holdings]);
  const hasTargets = targetsActive || Object.keys(targets).length > 0;

  const driftByMint = useMemo(() => {
    const map = new Map<string, DriftSlice>();
    for (const row of driftRows ?? []) {
      if (row.mint) map.set(row.mint, row);
    }
    return map;
  }, [driftRows]);

  const geometry = useMemo(() => {
    if (slices.length === 0) return null;
    const cx = 100;
    const cy = 100;
    const outer = 88;
    const inner = 52;
    let cursor = 0;
    const arcs = slices.map((slice, index) => {
      const sweep = (slice.weight / 100) * 360;
      const start = cursor;
      const end = cursor + sweep;
      cursor = end;
      return {slice, index, start, end, path: donutArc(cx, cy, outer, inner, start, end)};
    });
    return {cx, cy, inner, arcs};
  }, [slices]);

  const summary = useMemo(() => {
    if (slices.length === 0) return "No priced holdings";
    const top = slices
      .slice(0, 3)
      .map((slice) => `${slice.symbol} ${slice.weight.toFixed(1)}%`)
      .join(", ");
    return `Portfolio allocation: ${top}`;
  }, [slices]);

  const focus =
    active !== null && geometry ? geometry.arcs[active]?.slice : slices[0] ?? null;

  if (!geometry) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-2xl bg-[var(--segment-track)] px-6 text-center shadow-inset-soft",
          className,
        )}
        style={{height}}
      >
        <p className="max-w-[34ch] text-[12px] leading-[1.5] text-faint">
          Nothing priced yet — allocation appears once holdings have a live price.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(className)}>
      <div className="relative" style={{height}}>
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label={summary}
          className="mx-auto block h-full w-full max-w-[220px]"
        >
          {geometry.arcs.map(({slice, index, path}) => {
            const target = slice.mint ? targets[slice.mint] : undefined;
            const highlighted = active === null || active === index;
            return (
              <path
                key={slice.id}
                d={path}
                fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                opacity={highlighted ? 1 : 0.35}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(index)}
              >
                <title>
                  {slice.symbol} · {slice.weight.toFixed(1)}%
                  {hasTargets && target !== undefined
                    ? ` (target ${target.toFixed(1)}%)`
                    : ""}
                </title>
              </path>
            );
          })}
          {focus ? (
            <>
              <text
                x={geometry.cx}
                y={geometry.cy - 4}
                textAnchor="middle"
                className="fill-ink text-[11px] font-extrabold"
                style={{fontSize: 11}}
              >
                {focus.symbol}
              </text>
              <text
                x={geometry.cx}
                y={geometry.cy + 12}
                textAnchor="middle"
                className="fill-muted text-[10px] font-bold"
                style={{fontSize: 10}}
              >
                {focus.weight.toFixed(1)}%
              </text>
            </>
          ) : null}
        </svg>
      </div>

      <ul className="mt-2 space-y-1.5">
        {geometry.arcs.map(({slice, index}) => {
          const row = slice.mint ? driftByMint.get(slice.mint) : undefined;
          const target = row?.target ?? (slice.mint ? targets[slice.mint] : undefined);
          const showPair = hasTargets && slice.mint !== null && target !== undefined;

          return (
            <li
              key={slice.id}
              className={cn(
                "flex items-center gap-2 rounded-xl px-2 py-1.5 text-[12px] transition-colors",
                active === index && "bg-[var(--overlay-wash)]",
              )}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{background: SLICE_COLORS[index % SLICE_COLORS.length]}}
              />
              <span className="min-w-0 flex-1 truncate font-extrabold text-ink">
                {slice.symbol}
              </span>
              <span className="tabular-nums shrink-0 whitespace-nowrap text-[12px] font-extrabold text-muted">
                {showPair ? (
                  <>
                    {slice.weight.toFixed(1)}%
                    <span className="mx-0.5 font-bold text-faint">/</span>
                    {target.toFixed(1)}%
                  </>
                ) : (
                  `${slice.weight.toFixed(1)}%`
                )}
              </span>
              <span className="tabular-nums shrink-0 whitespace-nowrap text-[11px] font-semibold text-faint">
                {compactMoney(slice.valueUsd)}
              </span>
            </li>
          );
        })}
      </ul>
      {showTargetsHint && !hasTargets && slices.length > 0 ? (
        <p className="mt-2 px-2 text-[11.5px] font-medium leading-[1.45] text-faint">
          Tap Edit targets to set goals — then each row shows actual / target
          weights here.
        </p>
      ) : null}
    </div>
  );
}
