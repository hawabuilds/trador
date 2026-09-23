import {bondingCurvePda} from "@nirholas/pump-sdk";
import {PublicKey} from "@solana/web3.js";

import {asPubkey, samePubkey, type Pubkey} from "@/lib/pubkey";

/**
 * Account to pass to `getSignaturesForAddress` for curve tape.
 *
 * `rowToStonk` falls back to the mint when `pool` is null; pump.fun's curve
 * PDA is still derivable from the mint.
 */
export function curveTapeAddress(
  mint: Pubkey,
  pool: Pubkey | null,
  launchpad: "stonkfun" | "pumpfun",
): Pubkey | null {
  if (pool && !samePubkey(pool, mint)) return pool;
  if (launchpad === "pumpfun") {
    return bondingCurvePda(new PublicKey(mint)).toBase58() as Pubkey;
  }
  return null;
}

/** Resolve curve tape inputs from a store row. */
export function curveTapeFromRow(row: {
  mint: string;
  pool: string | null;
  launchpad: "stonkfun" | "pumpfun";
  quote_mint: string | null;
}): {address: Pubkey; quoteMint: Pubkey} | null {
  const mint = asPubkey(row.mint);
  const quoteMint = asPubkey(row.quote_mint);
  if (!mint || !quoteMint) return null;
  const address = curveTapeAddress(mint, asPubkey(row.pool), row.launchpad);
  if (!address) return null;
  return {address, quoteMint};
}
