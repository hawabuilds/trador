/**
 * Live prices for the tokenized stocks.
 *
 * The stock list itself comes from the registry rather than the store — the set
 * of verified equities changes a handful of times a year and every entry's mint
 * authority was checked by hand, so polling a database for it would add a query
 * per request to answer a question that is already in the bundle.
 *
 * Their **prices** are a different question, and that is what this answers. The
 * bundled snapshot carries a price per stock, frozen at the moment the snapshot
 * was generated. That was invisible while the registry held 29 names, because
 * the snapshot was regenerated alongside them. When the registry grew to 82 the
 * snapshot did not, so 53 of them had no entry at all and rendered a dash in the
 * feed — while their own pages, which price client-side, showed a real number.
 * Two surfaces disagreeing about the same stock is worse than either being
 * stale.
 *
 * So the feed prices them the same way it prices everything else: Jupiter, in
 * batches, cached. Three calls covers the whole list.
 *
 * **On authority.** A registry entry declares `priceAuthority: "pyth"`, and
 * nothing implements Pyth yet. This does not pretend otherwise — a price from
 * here is labelled `pool`, because that is what it is: an aggregate of on-chain
 * venues, not an exchange quote. It tracks well (NKE reads $36.12 here against
 * $36.14 on its own page) but the label has to say where it came from, or the
 * `priceAuthority` field stops meaning anything.
 */

import type {Pubkey} from "@/lib/pubkey";
import {cached} from "./cache";
import {jupTokens} from "./jupTokens";

/** One stock's live figures, as far as Jupiter knows them. */
export interface StockQuote {
  usd: number | null;
  changePct: number | null;
}

/**
 * Prices for a set of stock mints.
 *
 * Fifteen seconds of cache: the feed polls every fifteen, and an equity's price
 * does not move meaningfully inside that window. A provider failure returns the
 * last good map rather than an empty one, so a blip shows stale prices instead
 * of replacing every stock with a dash.
 */
export async function stockPrices(
  mints: readonly Pubkey[],
): Promise<Map<string, StockQuote>> {
  if (mints.length === 0) return new Map();

  // Keyed on the set, so a caller asking about a different list cannot be
  // served another list's answer.
  const key = `stock-prices:${[...mints].sort().join(",")}`;

  const {value} = await cached(key, 15_000, async () => {
    const tokens = await jupTokens([...mints]);
    const found = new Map<string, StockQuote>();

    for (const token of tokens.values()) {
      if (token.usdPrice === null) continue;
      found.set(token.mint, {
        usd: token.usdPrice,
        changePct: token.priceChange24h,
      });
    }

    return found;
  });

  return value;
}
