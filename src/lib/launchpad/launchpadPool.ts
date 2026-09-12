/**
 * Decode a Raydium LaunchLab pool, and decide whether it is a StonkFun launch.
 *
 * Attribution comes from this account and nothing else. Not the token's name,
 * not its symbol, not a listing site — a launchpad's coins are identifiable
 * because the pool records which platform config created them, and anyone can
 * name a token anything. The predecessor app enforced the same rule against
 * four near-identical EVM factories, and the one place it drifted cost a day.
 *
 * Pure functions over bytes: no RPC, no SDK, no `PublicKey`. That keeps it
 * testable against real captured accounts, which matters because the offsets it
 * reads were originally computed from Raydium's alpha SDK rather than observed.
 * `test/launchlab-layout.test.ts` pins them to finalized mainnet fixtures.
 */

import {LAUNCHPAD_POOL, stonkfunPlatformFor} from "@/lib/programs";
import {type Pubkey, isDefaultPubkey, readPubkeyAt} from "@/lib/pubkey";
import {type StockMint, stockForMint} from "@/lib/stocks/registry";

/**
 * LaunchLab's pool status.
 *
 * Observed on mainnet across 1,299 NVDAx-quoted StonkFun pools: 1,276 at 0 and
 * 23 at 2, with nothing at 1 — consistent with 1 being the brief window while
 * a migration is in flight.
 */
export const POOL_STATUS = {
  /** Still on the bonding curve. No pool, therefore no real liquidity. */
  FUND: 0,
  /** Migration in progress. */
  MIGRATE: 1,
  /** Graduated into a Raydium CPMM pool and trading. */
  TRADE: 2,
} as const;

export interface LaunchpadPoolState {
  readonly status: number;
  readonly graduated: boolean;
  /** The launched coin. */
  readonly baseMint: Pubkey;
  /** What the coin is priced in. */
  readonly quoteMint: Pubkey;
  readonly configId: Pubkey;
  readonly platformId: Pubkey;
  readonly creator: Pubkey;
  /**
   * Curve reserves. Named to make misuse awkward: these are *not* liquidity,
   * they are the seeded constants the curve prices against. Writing them into
   * a liquidity column is the single most common way a launchpad feed starts
   * lying about how much money is in a coin.
   */
  readonly virtualBase: bigint;
  readonly virtualQuote: bigint;
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset + 8 > data.length) return 0n;
  let value = 0n;
  for (let i = 7; i >= 0; i -= 1) value = (value << 8n) | BigInt(data[offset + i]);
  return value;
}

/**
 * Decode pool account data, or null if it is not a pool.
 *
 * The length check is the cheap canary for a layout change. Raydium appending a
 * field shifts every offset past it, and the symptom would otherwise be an
 * empty feed — the hardest failure to trace back to a layout, because nothing
 * throws and every individual read still returns 32 plausible bytes.
 */
export function decodeLaunchpadPool(data: Uint8Array): LaunchpadPoolState | null {
  if (data.length !== LAUNCHPAD_POOL.SPAN) return null;

  const baseMint = readPubkeyAt(data, LAUNCHPAD_POOL.MINT_A);
  const quoteMint = readPubkeyAt(data, LAUNCHPAD_POOL.MINT_B);
  const configId = readPubkeyAt(data, LAUNCHPAD_POOL.CONFIG_ID);
  const platformId = readPubkeyAt(data, LAUNCHPAD_POOL.PLATFORM_ID);
  const creator = readPubkeyAt(data, LAUNCHPAD_POOL.CREATOR);

  if (!baseMint || !quoteMint || !configId || !platformId || !creator) return null;

  /**
   * Reject the all-zero read.
   *
   * Thirty-two zero bytes are a perfectly valid base58 address — the all-ones
   * System Program id — so a zeroed account, a buffer sized right but never
   * filled, or an offset that landed in padding all decode "successfully" into
   * a pool whose every field looks well-formed. That is the exact silent
   * failure this decoder exists to prevent, and without this check it produces
   * one instead. A real pool has no zero mint, platform or creator.
   */
  if (
    isDefaultPubkey(baseMint) ||
    isDefaultPubkey(quoteMint) ||
    isDefaultPubkey(configId) ||
    isDefaultPubkey(platformId) ||
    isDefaultPubkey(creator)
  ) {
    return null;
  }

  const status = data[LAUNCHPAD_POOL.STATUS];

  return {
    status,
    graduated: status === POOL_STATUS.TRADE,
    baseMint,
    quoteMint,
    configId,
    platformId,
    creator,
    virtualBase: readU64LE(data, LAUNCHPAD_POOL.VIRTUAL_A),
    virtualQuote: readU64LE(data, LAUNCHPAD_POOL.VIRTUAL_B),
  };
}

export interface StonkfunLaunch {
  readonly pool: LaunchpadPoolState;
  /** Which StonkFun config created it. */
  readonly configKind: "rewards" | "standard";
  /**
   * Whether launches under this config route a share of every trade back to
   * holders, paid in the quote asset.
   */
  readonly paysHolders: boolean;
  /** The tokenized stock on the quote side, when there is one. */
  readonly stock: StockMint | null;
}

/**
 * Is this pool a StonkFun launch, and what kind?
 *
 * Returns null for every other LaunchLab pool — and most of them are. There are
 * tens of thousands of LaunchLab pools that have nothing to do with StonkFun,
 * so this check is what separates the app's universe from Raydium's.
 */
export function asStonkfunLaunch(pool: LaunchpadPoolState): StonkfunLaunch | null {
  const platform = stonkfunPlatformFor(pool.platformId);
  if (!platform) return null;

  return {
    pool,
    configKind: platform.kind,
    paysHolders: platform.paysHolders,
    stock: stockForMint(pool.quoteMint),
  };
}

export function decodeStonkfunLaunch(data: Uint8Array): StonkfunLaunch | null {
  const pool = decodeLaunchpadPool(data);
  return pool ? asStonkfunLaunch(pool) : null;
}

/** Is this coin priced on a curve rather than in a pool? */
export function isOnCurve(pool: LaunchpadPoolState): boolean {
  return pool.status !== POOL_STATUS.TRADE;
}

/**
 * Liquidity, as far as this account can say: always unknown.
 *
 * A function rather than an omission, because the tempting read is right there
 * in the struct. Pre-graduation there is no pool, so the only figures available
 * are the curve's seeded `virtual*` constants — not anyone's money. After
 * graduation the money is in a Raydium CPMM pool, which is a different account
 * this module does not read.
 *
 * Either way the answer from here is null, which `isTradeableFromLiquidity`
 * turns into "unevaluated, so show" rather than "zero, so hide".
 */
export function liquidityUsdFromPool(_pool: LaunchpadPoolState): null {
  return null;
}
