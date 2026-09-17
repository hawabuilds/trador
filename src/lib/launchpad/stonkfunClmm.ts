/**
 * StonkFun's second launch path: a coin opened straight into a Raydium CLMM pool.
 *
 * Most StonkFun launches start on a LaunchLab bonding curve and graduate later,
 * and that is the only shape this app used to look for. StonkFun also opens
 * coins directly into a concentrated-liquidity pool against a stock, with no
 * curve at all — and there are far more of those. On the day this was written:
 * 8,453 such pools, 4,633 of them paired with a verified stock, against 694
 * curve launches in the feed. Coins like ALICE (priced in VIDAx) and BUTTHOLE
 * (priced in ANTHROPIC) were simply never seen.
 *
 * ## Attribution
 *
 * Same rule as everywhere else: proved from program state, never from a name.
 * Raydium's CLMM `PoolState` records the account that created the pool in its
 * `owner` field, and on every pool here that is StonkFun's launcher wallet —
 * the same key the curve path's launches come from. So a pool is StonkFun's iff
 * it is a CLMM `PoolState` and its `owner` is that wallet. Checked on the two
 * coins that were reported missing before anything else was written.
 *
 * ## Layout
 *
 * Offsets from Raydium's `PoolState`, 1,544 bytes including the discriminator:
 *
 *   owner          41..73    the creator — StonkFun's launcher, for these
 *   token_mint_0   73..105
 *   token_mint_1   105..137
 *   mint_decimals  233, 234
 *
 * The decimals were checked against real pools (VIDAx reads 8, ALICE 9), which
 * is what confirms the mint offsets before them. The two mints are ordered by
 * address, **not** by base and quote — so which side is the stock is decided
 * against the verified registry, and a pool where neither side (or both) is a
 * stock is not a launch this app lists.
 *
 * No launch timestamp is read from here, because there is none: a scan of both
 * reported pools found no value within three days of their creation. The launch
 * time comes from the token's own creation, which for this path is the same
 * transaction as the pool's.
 */

import {RAYDIUM_CLMM, STONKFUN_LAUNCHER} from "@/lib/programs";
import {type Pubkey, readPubkeyAt} from "@/lib/pubkey";
import {type StockMint, stockForMint} from "@/lib/stocks/registry";

export const CLMM_POOL = {
  PROGRAM: RAYDIUM_CLMM,
  SPAN: 1544,
  OWNER: 41,
  MINT_0: 73,
  MINT_1: 105,
} as const;

/**
 * The slice a scan needs: both mints and nothing else. The owner filter is
 * applied by the RPC, so it never has to be read back.
 */
export const CLMM_MINTS_SLICE = {offset: CLMM_POOL.MINT_0, length: 64} as const;

/** `getProgramAccounts` filters selecting exactly StonkFun's CLMM pools. */
export function stonkfunClmmFilters() {
  return [
    {dataSize: CLMM_POOL.SPAN},
    {memcmp: {offset: CLMM_POOL.OWNER, bytes: STONKFUN_LAUNCHER as string}},
  ];
}

export interface ClmmLaunch {
  pool: Pubkey;
  /** The launched coin. */
  mint: Pubkey;
  /** The verified stock it is priced in. */
  quote: StockMint;
}

/**
 * One pool, read from the 64-byte mints slice.
 *
 * Null for anything that is not a coin priced in exactly one verified stock:
 * a SOL or USDC pair, a memecoin pair, or a stock-to-stock pool, which is a
 * market between two equities rather than a launch.
 */
export function decodeClmmLaunch(pool: Pubkey, slice: Uint8Array): ClmmLaunch | null {
  if (slice.length < 64) return null;

  const mint0 = readPubkeyAt(slice, 0);
  const mint1 = readPubkeyAt(slice, 32);
  if (!mint0 || !mint1) return null;

  const stock0 = stockForMint(mint0);
  const stock1 = stockForMint(mint1);

  if (stock0 && !stock1) return {pool, mint: mint1, quote: stock0};
  if (stock1 && !stock0) return {pool, mint: mint0, quote: stock1};
  return null;
}
