/**
 * What a commenter did in the coin they are commenting on.
 *
 * A comment on a trading screen is a claim — "we fly from here" — and the most
 * useful thing to put beside a claim is whether the person making it has money
 * on it. So each comment carries its author's position in that one coin, read
 * from the trades their own wallet made on chain: how much they put in, whether
 * they still hold, and how it has gone.
 *
 * All of it is derived, never typed. A commenter cannot claim a position they
 * do not have, because there is no field to claim it in.
 */

export interface CommentTrade {
  side: "buy" | "sell";
  /** Units of the coin. */
  amount: number;
  /** Dollar value at the time, or null when the paid side had no price. */
  valueUsd: number | null;
}

export interface CommentPosition {
  /** Dollars put in across every buy. */
  boughtUsd: number;
  /** Dollars taken out across every sell. */
  soldUsd: number;
  /**
   * `holding` while any meaningful amount is still held, `sold` once it is all
   * gone. A position that was never opened has no summary at all.
   */
  status: "holding" | "sold";
  /**
   * Total return on what was put in: taken out plus what is still held at the
   * current price, against what went in. Null when that cannot be said
   * honestly — see the checks below.
   */
  gainPct: number | null;
}

/**
 * Less than this share of what was bought still held counts as sold.
 *
 * Selling "all" through a router routinely leaves a few base units behind, and
 * calling that position open would label someone "holding" a coin they sold.
 */
const DUST_SHARE = 0.001;

export function commentPosition(
  trades: readonly CommentTrade[],
  priceUsd: number | null,
): CommentPosition | null {
  let bought = 0;
  let sold = 0;
  let boughtUsd = 0;
  let soldUsd = 0;
  // Any unpriced trade makes a dollar figure partial, and a partial figure
  // presented as a return would be a number that looks precise and is not.
  let complete = true;

  for (const trade of trades) {
    if (!(trade.amount > 0)) continue;
    if (trade.side === "buy") {
      bought += trade.amount;
      if (trade.valueUsd === null) complete = false;
      else boughtUsd += trade.valueUsd;
    } else {
      sold += trade.amount;
      if (trade.valueUsd === null) complete = false;
      else soldUsd += trade.valueUsd;
    }
  }

  // Never bought here — a transfer in, an airdrop. There is no position to
  // describe, and inventing one from a sell alone would be guessing.
  if (bought === 0) return null;

  const held = Math.max(0, bought - sold);
  const status = held > bought * DUST_SHARE ? "holding" : "sold";

  /*
   * The return, when every input to it is real.
   *
   * Held units need a current price to be worth anything; a sold-out position
   * does not, which is why a closed trade can still show its result when the
   * coin has no price today.
   */
  let gainPct: number | null = null;
  const heldValue = status === "holding" ? (priceUsd === null ? null : held * priceUsd) : 0;
  if (complete && boughtUsd > 0 && heldValue !== null) {
    gainPct = ((soldUsd + heldValue - boughtUsd) / boughtUsd) * 100;
  }

  return {boughtUsd, soldUsd, status, gainPct};
}
