"use client";

import {cn} from "@/lib/cn";

/**
 * How close a launch is to graduating.
 *
 * The only number the Graduating tab claims, so it is read straight off the
 * pool — quote raised over the fund-raising target — and never derived from a
 * price. A coin on a curve has no pool and therefore no price this app is
 * willing to print.
 *
 * Renders nothing at all when progress is null. Null means unmeasured, and an
 * empty bar would say "nobody has bought this" — a claim about the coin rather
 * than about our data.
 *
 * The percentage is always shown beside the bar, not only on hover. Length
 * alone is a comparison ("more than that one"), and the question here is
 * absolute: how far from the finish.
 */
export function CurveProgress({
  progress,
  className,
}: {
  progress: number | null;
  className?: string;
}) {
  if (progress === null || !Number.isFinite(progress)) return null;

  const pct = Math.min(100, Math.max(0, progress * 100));
  // Nearly-there launches get the price-up colour; the rest stay neutral so the
  // tab does not read as fifty green bars.
  const close = pct >= 50;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--segment-track)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress to graduation"
      >
        <div
          style={{width: `${pct}%`}}
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            close ? "bg-price-up" : "bg-[var(--accent)]",
          )}
        />
      </div>
      <span
        className={cn(
          "tabular-nums shrink-0 text-[12px] font-extrabold",
          close ? "text-price-up" : "text-muted",
        )}
      >
        {pct.toFixed(pct < 10 ? 1 : 0)}%
      </span>
    </div>
  );
}
