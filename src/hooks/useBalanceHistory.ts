"use client";

import {useMemo} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";

import type {BalancePoint} from "@/components/BalanceChart";

export const BALANCE_RANGES = ["1d", "1w", "1m", "all"] as const;
export type BalanceRange = (typeof BALANCE_RANGES)[number];

interface HistoryResponse {
  snapshots: BalancePoint[];
  /** False when no database is configured, so the chart can say which. */
  ready: boolean;
}

/**
 * A wallet's value over time, with the live total pinned to the right edge.
 *
 * The stored snapshots are at most ten minutes apart, so the newest one is
 * usually stale by the time it renders. Appending the live total means the
 * chart's last point always agrees with the big number above it — without that,
 * the two disagree by whatever moved in the last few minutes, which reads as a
 * bug in the chart rather than as sampling.
 *
 * When the newest snapshot is itself only seconds old, the live value replaces
 * it rather than being appended, so a refetch cannot stack two points on the
 * same instant and put a vertical segment at the end of the line.
 */
/** Pure merge used by the hook — exported for tests. */
export function balancePointsWithLive(
  snapshots: BalancePoint[],
  liveTotal: number | null,
): BalancePoint[] {
  if (liveTotal === null) return snapshots;

  const live: BalancePoint = {t: Date.now(), value: liveTotal};
  const last = snapshots[snapshots.length - 1];

  if (!last) return [live];
  if (live.t - last.t < 60_000) return [...snapshots.slice(0, -1), live];
  return [...snapshots, live];
}

/**
 * Period change for the selected range: first stored snapshot → live total.
 *
 * Chart points can collapse to one when the newest snapshot is replaced by the
 * live pin, so change must not depend on `points.length` alone.
 */
export function balanceChangeForRange(
  snapshots: readonly BalancePoint[],
  liveTotal: number | null,
  points: readonly BalancePoint[],
): {usd: number; pct: number} | null {
  if (liveTotal !== null && snapshots.length >= 1) {
    const open = snapshots[0].value;
    const usd = liveTotal - open;
    return {usd, pct: open > 0 ? (usd / open) * 100 : 0};
  }

  // One point is a reading, not a change — same rule as before when live is unknown.
  if (points.length < 2) return null;

  const open = points[0].value;
  const close = points[points.length - 1].value;
  const usd = close - open;
  return {usd, pct: open > 0 ? (usd / open) * 100 : 0};
}

export function useBalanceHistory(
  wallet: string | null | undefined,
  range: BalanceRange,
  liveTotal: number | null,
) {
  const query = useQuery({
    queryKey: ["stonkfolio-history", wallet, range],
    enabled: Boolean(wallet),
    staleTime: 60_000,
    refetchInterval: 120_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<HistoryResponse> => {
      const response = await fetch(
        `/api/stonkfolio/history?wallet=${wallet}&range=${range}`,
      );
      if (!response.ok) throw new Error("Could not read your balance history.");
      return (await response.json()) as HistoryResponse;
    },
  });

  const points = useMemo<BalancePoint[]>(
    () => balancePointsWithLive(query.data?.snapshots ?? [], liveTotal),
    [query.data?.snapshots, liveTotal],
  );

  const change = useMemo(
    () => balanceChangeForRange(query.data?.snapshots ?? [], liveTotal, points),
    [query.data?.snapshots, liveTotal, points],
  );

  return {
    points,
    change,
    /** False only when no store is configured — not merely when it is empty. */
    ready: query.data?.ready ?? true,
    isLoading: query.isLoading,
  };
}
