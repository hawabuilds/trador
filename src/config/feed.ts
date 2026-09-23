/**
 * The floor under the New sort.
 *
 * Shared because it has to hold in two places at once. The store applies it so
 * a page of forty rows is forty *visible* rows — without that, paging fetches
 * a page, the client hides most of it, and scrolling stalls on a list that
 * grows by three rows per request. The client applies it too, because the
 * snapshot fallback never goes through the store at all.
 *
 * Chosen against the distribution rather than picked round: $10K keeps 84 of
 * the 694 listed coins, dropping the $1K–$5K band that is 75% of them on its
 * own. The median listed coin is worth $2.9K, against the ~$39K it was worth
 * the moment it graduated — so the floor sits under every genuinely new coin
 * and over almost every dead one.
 *
 * The numbers move as the universe grows; the reasoning does not. It is a
 * fraction of the graduation market cap, not a round number.
 *
 * Only the New sort. Market cap ranks the full listed universe; Trending has
 * its own floor at {@link TRENDING_MIN_MCAP_USD}.
 */
export const NEW_FEED_MIN_MCAP_USD = 10_000;

/**
 * Minimum market cap for the Trending sort — hides micro-caps that still qualify
 * for New via recency. Applied in the store, Postgres, and snapshot fallback so
 * paging and quote-chip totals stay aligned.
 */
export const TRENDING_MIN_MCAP_USD = 25_000;

/**
 * How long after graduation the New sort keeps a coin visible even when it has
 * already fallen under {@link NEW_FEED_MIN_MCAP_USD}.
 *
 * Graduation still lands near the raise size, but the decorate pass and the
 * first trades often print a lower mark minutes later — and the $10K floor was
 * hiding every coin in that window, which read as "nothing new for hours" on
 * the New tab while Trending still moved.
 *
 * Recency does not bypass a missing cap: unpriced rows stay off New until
 * Jupiter decoration writes a positive `last_mcap`.
 */
export const NEW_FEED_RECENCY_MS = 48 * 60 * 60_000;

export function passesNewFeedFloor(
  marketCapUsd: number | null,
  graduatedAt: string | null,
  nowMs = Date.now(),
): boolean {
  if (
    marketCapUsd == null ||
    !Number.isFinite(marketCapUsd) ||
    marketCapUsd <= 0
  ) {
    return false;
  }
  if (marketCapUsd >= NEW_FEED_MIN_MCAP_USD) return true;
  if (!graduatedAt) return false;
  return nowMs - Date.parse(graduatedAt) <= NEW_FEED_RECENCY_MS;
}

/** Same floor as the store's New sort — for snapshot fallback and client filter. */
export function filterNewFeedStonks<
  T extends {marketCapUsd: number | null; listedAt: string | null},
>(items: readonly T[]): T[] {
  return items.filter((stonk) =>
    passesNewFeedFloor(stonk.marketCapUsd, stonk.listedAt ?? null),
  );
}

export function passesTrendingFeedFloor(marketCapUsd: number | null): boolean {
  return (
    marketCapUsd != null &&
    Number.isFinite(marketCapUsd) &&
    marketCapUsd >= TRENDING_MIN_MCAP_USD
  );
}

/** Same floor as the store's Trending sort — for snapshot fallback and client filter. */
export function filterTrendingFeedStonks<
  T extends {marketCapUsd: number | null},
>(items: readonly T[]): T[] {
  return items.filter((stonk) => passesTrendingFeedFloor(stonk.marketCapUsd));
}
