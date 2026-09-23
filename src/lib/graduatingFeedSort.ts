import type {Stonk} from "@/lib/types";

import {compareDescNullsLast, compareMintDesc} from "@/lib/trendingFeedSort";

/**
 * Client order for Graduating — matches `pgListGraduating` / `listGraduating`:
 *
 * `curve_progress desc nulls last, trending_score desc nulls last,
 *  vol_24h desc nulls last, mint desc`.
 *
 * Progress keeps the tab about coins close to graduation; trending score and
 * 24h volume break ties so active curve launches rank above quiet ones at the
 * same progress. Pending rows get `trendingScore` from the decorate pass.
 */
export function compareGraduatingStonks(a: Stonk, b: Stonk): number {
  const byProgress = compareDescNullsLast(a.curveProgress, b.curveProgress);
  if (byProgress !== 0) return byProgress;

  const byTrending = compareDescNullsLast(a.trendingScore, b.trendingScore);
  if (byTrending !== 0) return byTrending;

  const byVol = compareDescNullsLast(a.volume24hUsd, b.volume24hUsd);
  if (byVol !== 0) return byVol;

  return compareMintDesc(a.mint, b.mint);
}

export function sortStonksGraduating<T extends Stonk>(items: readonly T[]): T[] {
  return [...items].sort(compareGraduatingStonks);
}

/** Launches still on the curve — never a graduated row. */
export function isGraduatingStonk(stonk: Pick<Stonk, "status">): boolean {
  return stonk.status === "pending";
}

/** Graduated coins only — the New and Trending feeds. */
export function isGraduatedListedStonk(stonk: Pick<Stonk, "status">): boolean {
  return stonk.status === "listed";
}

/**
 * Still on the bonding curve for UI and chart routing.
 *
 * `status = listed` is authoritative — a stale `curve_progress` left over from
 * the graduating sweep must not keep showing a progress bar after the reconciler
 * marks the pool TRADE.
 */
export function isOnBondingCurve(
  stonk: Pick<Stonk, "status" | "curveProgress">,
): boolean {
  if (stonk.status === "listed") return false;
  return stonk.status === "pending" || stonk.curveProgress !== null;
}
