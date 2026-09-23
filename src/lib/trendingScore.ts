/**
 * Trending rank for graduated coins — a weighted mix of short-horizon activity.
 *
 * Inputs come from Jupiter's token stats (vol windows, trade counts, traders).
 * `pageViews` is optional in-app engagement from `stonk_stats.page_views`.
 * When every activity metric is missing, returns null so callers can fall back
 * to sorting by `vol_24h` alone.
 */

export interface TrendingInputs {
  vol1hUsd: number | null | undefined;
  vol24hUsd: number | null | undefined;
  txs24h: number | null | undefined;
  uniqueMakers24h: number | null | undefined;
  pageViews?: number | null | undefined;
}

const finite = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

/** log10(1 + x), safe for null/zero. */
function log1p(value: number | null): number {
  if (value === null || value <= 0) return 0;
  return Math.log10(value + 1);
}

/**
 * Weights mirror DexScreener-style emphasis: recent volume first, then 24h
 * depth, then trade intensity and unique participation, with a small nudge
 * from in-app page views when present.
 */
export function computeTrendingScore(raw: TrendingInputs): number | null {
  const vol1h = finite(raw.vol1hUsd);
  const vol24 = finite(raw.vol24hUsd);
  const txs = finite(raw.txs24h);
  const makers = finite(raw.uniqueMakers24h);
  const views = finite(raw.pageViews ?? null);

  const hasActivity =
    (vol1h !== null && vol1h > 0) ||
    (vol24 !== null && vol24 > 0) ||
    (txs !== null && txs > 0) ||
    (makers !== null && makers > 0);

  if (!hasActivity && (views === null || views <= 0)) return null;

  return (
    log1p(vol1h) * 0.4 +
    log1p(vol24) * 0.3 +
    log1p(txs) * 0.15 +
    log1p(makers) * 0.1 +
    log1p(views) * 0.05
  );
}
