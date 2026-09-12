/**
 * Nullable boolean flags on `stonks` (`eligible`, `is_tradeable`,
 * `is_custom_pair`).
 *
 *   true  = evaluated, passes  → show
 *   false = evaluated, fails   → hide
 *   null  = NOT YET EVALUATED  → show
 *
 * Filtering `.eq(column, true)` or SQL `AND column` collapses three states into
 * two. Newly indexed rows default to null, vanish from the feed, and the feed
 * looks like a broken query rather than a filtering mistake. That emptied the
 * predecessor app three times, which is why this is a module and a lint rule
 * rather than a convention.
 *
 * Postgres:  `column IS DISTINCT FROM false`
 * PostgREST: `.or("column.is.null,column.is.true")` — never `.eq(column, true)`
 * JS:        `value !== false`
 *
 * On Solana two of the three flags carry meanings the EVM version had no need
 * for, and both depend on null meaning "show":
 *
 *   `eligible` also carries confirmation state. A launch seen at `confirmed`
 *   commitment is real enough to show but not yet final, so it is written null.
 *   Finalization sets true; a dropped fork sets false and keeps the row, so the
 *   coin disappears from the feed without the indexer losing what it learned.
 *
 *   `is_custom_pair` stays null until pump.fun's Custom Pairs account layout is
 *   verified. Defaulting it to false to simplify a query would silently hide
 *   every stock-paired pump.fun coin — which is most of the reason this app
 *   exists.
 */

export type ThreeStateFlag = "eligible" | "is_tradeable" | "is_custom_pair";

export type ThreeState = boolean | null | undefined;

export function showsThreeState(value: ThreeState): boolean {
  return value !== false;
}

/** Has this flag actually been evaluated? */
export function isEvaluated(value: ThreeState): boolean {
  return value === true || value === false;
}

/** PostgREST equivalent of `column IS DISTINCT FROM false`. */
export function applyThreeStateFilter<T>(request: T, column: ThreeStateFlag): T {
  return (request as {or: (filter: string) => T}).or(
    `${column}.is.null,${column}.is.true`,
  );
}

/**
 * Liquidity is three-state too, and for a Solana-specific reason.
 *
 * A coin still on its bonding curve has no pool and therefore no liquidity —
 * but it does have virtual reserves, which every provider will happily report
 * as liquidity because the number is right there in the account. The EVM
 * version learned this the hard way: fourteen of its twenty newest rows showed
 * within a few hundred dollars of the same "liquidity", because the figure was
 * a seeded curve reserve rather than anyone's money. One read half a billion.
 *
 * So a pre-graduation coin gets null, not zero and not the reserve. Null keeps
 * it in the feed without inventing a number for it.
 */
export function isTradeableFromLiquidity(
  liquidityUsd: number | null | undefined,
  floorUsd: number,
): boolean | null {
  if (liquidityUsd === null || liquidityUsd === undefined) return null;
  return liquidityUsd >= floorUsd;
}
