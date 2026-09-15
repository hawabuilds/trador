/**
 * Notices a coin crossing out of the curve, and tells the people watching it.
 *
 * Runs from the indexer, which is the only thing that sees both states. The
 * detection is a diff rather than an event: the sweep knows which mints are
 * `pending` now, and the store knows which were `pending` last time, so a coin
 * that has left that set has graduated. There is no log to subscribe to.
 *
 * Every send goes through `dispatch`, so the ledger there is what stops a coin
 * from being announced on every pass for the rest of its life.
 */

import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {GRADUATING_SOON_AT, notifyGraduated, notifyGraduatingSoon} from "./events";

/** Everyone watching or holding this coin, by user id. */
async function interestedIn(mint: string): Promise<string[]> {
  if (!hasAdminPg) return [];

  return withClient(async (client) => {
    const {rows} = await client.query(
      `select distinct user_id from public.watchlist
        where kind = 'stonk' and asset_id = $1`,
      [mint],
    );
    return rows.map((row) => String(row.user_id));
  });
}

/**
 * Tell watchers about coins that just crossed 90%.
 *
 * `progress` comes from the sweep that just ran, so this is called with the
 * fresh numbers rather than re-reading them.
 */
export async function notifyNearGraduation(
  coins: readonly {mint: string; symbol: string | null; progress: number}[],
): Promise<number> {
  if (!hasAdminPg) return 0;

  let sent = 0;

  for (const coin of coins) {
    if (coin.progress < GRADUATING_SOON_AT) continue;

    const watchers = await interestedIn(coin.mint);
    for (const userId of watchers) {
      const outcome = await notifyGraduatingSoon({
        userId,
        mint: coin.mint,
        symbol: coin.symbol ?? "A coin you watch",
        progress: coin.progress,
      });
      if (outcome === "sent") sent += 1;
    }
  }

  return sent;
}

/**
 * Tell watchers about coins that have finished.
 *
 * `stillPending` is the mint set the sweep just wrote. Anything the store has
 * as `pending` that is *not* in it has either graduated or fallen back below
 * the floor — and the second case is filtered by checking the row's status,
 * because a coin dropping out of the tab is not an event worth a buzz.
 */
export async function notifyGraduations(
  stillPending: ReadonlySet<string>,
): Promise<number> {
  if (!hasAdminPg) return 0;

  const graduated = await withClient(async (client) => {
    const {rows} = await client.query(
      `select mint, symbol, quote_ticker from public.stonks
        where status = 'listed' and curve_progress is not null`,
    );
    return rows as {mint: string; symbol: string | null; quote_ticker: string | null}[];
  });

  let sent = 0;

  for (const coin of graduated) {
    // Still on the curve according to this sweep, so nothing happened.
    if (stillPending.has(coin.mint)) continue;

    const watchers = await interestedIn(coin.mint);
    for (const userId of watchers) {
      const outcome = await notifyGraduated({
        userId,
        mint: coin.mint,
        symbol: coin.symbol ?? "A coin you watch",
        quoteTicker: coin.quote_ticker ?? "its stock",
      });
      if (outcome === "sent") sent += 1;
    }
  }

  /*
   * Clear the progress on coins that have graduated.
   *
   * Otherwise this query keeps returning them forever — the dispatch ledger
   * would stop the duplicate sends, but the scan would grow without bound and
   * the row would carry a stale percentage that means nothing now.
   */
  await withClient((client) =>
    client.query(
      `update public.stonks set curve_progress = null
        where status = 'listed' and curve_progress is not null`,
    ),
  );

  return sent;
}
