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
 * Only this sort. Market cap and Trending are explicitly rankings — hiding rows
 * there would make the ordering lie about what it is ordering.
 */
export const NEW_FEED_MIN_MCAP_USD = 10_000;
