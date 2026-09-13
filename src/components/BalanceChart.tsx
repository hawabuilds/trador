"use client";

import {useMemo, useState} from "react";

import {cn} from "@/lib/cn";
import {money} from "@/lib/format";

export interface BalancePoint {
  /** Epoch milliseconds. */
  t: number;
  value: number;
}

/**
 * A wallet's value over time.
 *
 * Drawn as a plain SVG area rather than through `lightweight-charts`. The chart
 * library is already a dependency and is the right tool on a coin page — it
 * brings crosshairs, candles, a time axis and log scales. None of those apply
 * to a balance line, and loading ~45KB plus a client-only boundary to draw a
 * hundred points would make the Stonkfolio's first paint wait on a canvas.
 *
 * Two decisions the shape depends on:
 *
 *   1. **The baseline is the minimum in view, not zero.** A wallet that moves
 *      between $980 and $1,020 is a flat line against a zero axis, which is the
 *      opposite of what a growth chart is for. The floor is padded so the low
 *      point is not welded to the bottom edge.
 *   2. **Colour comes from first-to-last, not from the last tick.** A line that
 *      is green because the most recent point ticked up, while the window as a
 *      whole is down, tells the reader the wrong thing about the period they
 *      asked to see.
 */
export function BalanceChart({
  points,
  className,
  height = 132,
  onScrub,
}: {
  points: readonly BalancePoint[];
  className?: string;
  height?: number;
  /** Fires with the hovered point, or null when the pointer leaves. */
  onScrub?: (point: BalancePoint | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  // A viewBox in abstract units with `preserveAspectRatio="none"` lets the SVG
  // stretch to whatever width the column is, without measuring the DOM.
  const W = 1000;
  const H = 300;

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);

    /*
     * A flat series has no range, and dividing by it would put every point at
     * NaN — which renders as an empty chart rather than the straight line it
     * should be. Giving a flat window a nominal span centres it instead.
     */
    const span = max - min || Math.max(max * 0.02, 1);
    const floor = min - span * 0.15;
    const ceiling = max + span * 0.15;

    const x = (index: number) =>
      points.length === 1 ? W / 2 : (index / (points.length - 1)) * W;
    const y = (value: number) =>
      H - ((value - floor) / (ceiling - floor)) * H;

    const line = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`)
      .join(" ");

    return {
      line,
      area: `${line} L${W},${H} L0,${H} Z`,
      x,
      y,
      rising: points[points.length - 1].value >= points[0].value,
    };
  }, [points]);

  if (!geometry) return null;

  const up = geometry.rising;
  const stroke = up ? "var(--price-up)" : "var(--price-down)";
  const gradientId = `balance-fill-${up ? "up" : "down"}`;

  const hovered = hover === null ? null : points[hover];

  function pick(clientRatio: number) {
    const index = Math.round(clientRatio * (points.length - 1));
    const clamped = Math.min(points.length - 1, Math.max(0, index));
    setHover(clamped);
    onScrub?.(points[clamped]);
  }

  return (
    <div className={cn("relative", className)} style={{height}}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full touch-none"
        role="img"
        aria-label={`Balance chart, ${money(points[0].value)} to ${money(
          points[points.length - 1].value,
        )}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          if (box.width === 0) return;
          pick((event.clientX - box.left) / box.width);
        }}
        onPointerLeave={() => {
          setHover(null);
          onScrub?.(null);
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={geometry.area} fill={`url(#${gradientId})`} />
        <path
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          // The viewBox is stretched horizontally, so an unscaled stroke would
          // be drawn thinner on a wide screen than a narrow one.
          vectorEffect="non-scaling-stroke"
        />

        {hovered ? (
          <line
            x1={geometry.x(hover!)}
            y1={0}
            x2={geometry.x(hover!)}
            y2={H}
            stroke="var(--border-default)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      {/*
        The dot is a separate absolutely-positioned element rather than an SVG
        circle: inside a stretched viewBox a circle renders as an ellipse, and
        the distortion is severe at these proportions.
      */}
      {hovered ? (
        <span
          aria-hidden="true"
          style={{
            left: `${(geometry.x(hover!) / W) * 100}%`,
            top: `${(geometry.y(hovered.value) / H) * 100}%`,
            backgroundColor: stroke,
          }}
          className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--bg-base)]"
        />
      ) : null}
    </div>
  );
}
