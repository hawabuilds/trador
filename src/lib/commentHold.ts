/**
 * Whether a live or cached balance counts as holding, for hold-to-comment.
 *
 * Kept out of the comments store so the decision can be tested without
 * standing up RPC or Postgres. The rule itself is unchanged: any real
 * position may speak; router dust may not.
 */

import {samePubkey, type Pubkey} from "@/lib/pubkey";
import type {CommentPositionView} from "@/lib/types";

/** Same floor `holdsAsset` has always used — a cent, not a dollar. */
export const MIN_POSITION_USD = 0.01;

/**
 * Does this ui amount count as a position?
 *
 * No current price: any positive balance holds, because refusing a real
 * holder is worse than letting dust through. With a price: below a cent is
 * the crumb a router leaves after "sell all".
 */
/**
 * Badge for a public comment when we know they hold the coin, but not what
 * they paid. The dollar line stays off (`boughtUsd` is 0) so we never print
 * a fabricated cost basis next to someone who just bought, or whose history
 * has not been read yet.
 */
export function heldCommentPosition(): CommentPositionView {
  return {boughtUsd: 0, status: "holding", gainPct: null};
}

export function uiAmountHolds(uiAmount: number, priceUsd: number | null): boolean {
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) return false;
  return priceUsd === null ? true : uiAmount * priceUsd >= MIN_POSITION_USD;
}

/**
 * This mint's ui amount in a Stonkfolio cache map.
 *
 * Compared with `samePubkey` — never case-folded — so a stock mint and a
 * token mint that differ only in letter case cannot stand in for each other.
 */
export function uiAmountForMint(
  byMint: ReadonlyMap<string, number>,
  mint: Pubkey,
): number {
  let total = 0;
  for (const [key, amount] of byMint) {
    if (!samePubkey(key, mint)) continue;
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
      total += amount;
    }
  }
  return total;
}

/**
 * Which balance Stonkfolio would trust for this wallet right now.
 *
 * Fresh cache (the 90s row the portfolio already read) wins, so comments
 * agree with the holdings list. Live RPC is next. A stale cache is last,
 * and only when the chain could not be read — the same fallback Stonkfolio
 * uses when RPC 429s. A failed RPC with no cache is a hard miss, not "not
 * holding".
 */
export function resolveHeldUiAmount(input: {
  /** Set when `wallet_holdings_cache` is within TTL, including a genuine zero. */
  freshCache: number | undefined;
  rpc: {ok: true; uiAmount: number} | {ok: false};
  /** Set when a row exists past TTL. */
  staleCache: number | undefined;
}): {uiAmount: number} | {failed: true} {
  if (input.freshCache !== undefined) return {uiAmount: input.freshCache};
  if (input.rpc.ok) return {uiAmount: input.rpc.uiAmount};
  if (input.staleCache !== undefined) return {uiAmount: input.staleCache};
  return {failed: true};
}
