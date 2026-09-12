/**
 * Decode a PumpSwap pool, and decide whether it is a pump.fun Custom Pair.
 *
 * Custom Pairs are the reason this module exists, and finding them took
 * correcting a wrong assumption. pump.fun's bonding curve is SOL-only — its
 * `BondingCurve` account has no quote mint and `create_v2` accepts none — so a
 * coin priced in NVDAx is not a curve at all. It is a **PumpSwap pool** whose
 * `quote_mint` is the stock.
 *
 * Which makes attribution here simpler than StonkFun's. There is no platform
 * config to match: a pool on PumpSwap was made by pump.fun, and whether it is a
 * Custom Pair is just a question about its quote mint. The registry answers it.
 *
 * Pure functions over bytes, no RPC and no SDK, so the offsets can be pinned
 * against real captured accounts in `test/pump-layout.test.ts`.
 */

import {PUMPSWAP_POOL} from "@/lib/programs";
import {type Pubkey, isDefaultPubkey, readPubkeyAt} from "@/lib/pubkey";
import {type StockMint, stockForMint} from "@/lib/stocks/registry";

export interface PumpPoolState {
  readonly index: number;
  readonly creator: Pubkey;
  /** The coin. */
  readonly baseMint: Pubkey;
  /** What the coin is priced in — SOL for most pools, a stock for a Custom Pair. */
  readonly quoteMint: Pubkey;
  readonly lpMint: Pubkey;
  readonly baseTokenAccount: Pubkey;
  readonly quoteTokenAccount: Pubkey;
  readonly coinCreator: Pubkey;
  /** True for the older 245-byte layout, which is still live. */
  readonly legacy: boolean;
}

/**
 * Decode pool account data, or null if it is not a pool.
 *
 * Accepts both live sizes. Rejecting anything but the current span would drop
 * the 4,368 legacy pools; rejecting anything but the legacy span — the mistake
 * that was easy to make from the SDK types alone — would drop 97% of the
 * program including every Custom Pair.
 */
export function decodePumpPool(data: Uint8Array): PumpPoolState | null {
  const legacy = data.length === PUMPSWAP_POOL.LEGACY_SPAN;
  if (data.length !== PUMPSWAP_POOL.SPAN && !legacy) return null;

  const creator = readPubkeyAt(data, PUMPSWAP_POOL.CREATOR);
  const baseMint = readPubkeyAt(data, PUMPSWAP_POOL.BASE_MINT);
  const quoteMint = readPubkeyAt(data, PUMPSWAP_POOL.QUOTE_MINT);
  const lpMint = readPubkeyAt(data, PUMPSWAP_POOL.LP_MINT);
  const baseTokenAccount = readPubkeyAt(data, PUMPSWAP_POOL.BASE_TOKEN_ACCOUNT);
  const quoteTokenAccount = readPubkeyAt(data, PUMPSWAP_POOL.QUOTE_TOKEN_ACCOUNT);
  const coinCreator = readPubkeyAt(data, PUMPSWAP_POOL.COIN_CREATOR);

  if (
    !creator ||
    !baseMint ||
    !quoteMint ||
    !lpMint ||
    !baseTokenAccount ||
    !quoteTokenAccount ||
    !coinCreator
  ) {
    return null;
  }

  // Thirty-two zero bytes are a valid base58 address, so a zeroed or
  // never-initialised account otherwise decodes into a pool whose every field
  // looks well-formed. `coinCreator` is exempt: it is legitimately unset on
  // pools created before creator fees existed.
  if (
    isDefaultPubkey(baseMint) ||
    isDefaultPubkey(quoteMint) ||
    isDefaultPubkey(lpMint) ||
    isDefaultPubkey(creator)
  ) {
    return null;
  }

  return {
    index: data[PUMPSWAP_POOL.INDEX] | (data[PUMPSWAP_POOL.INDEX + 1] << 8),
    creator,
    baseMint,
    quoteMint,
    lpMint,
    baseTokenAccount,
    quoteTokenAccount,
    coinCreator,
    legacy,
  };
}

export interface PumpCustomPair {
  readonly pool: PumpPoolState;
  /** The tokenized stock this coin is priced in. */
  readonly stock: StockMint;
}

/**
 * Is this pool a Custom Pair — a pump.fun coin priced in a verified stock?
 *
 * Null for every SOL-quoted pool, which is almost all of them.
 */
export function asCustomPair(pool: PumpPoolState): PumpCustomPair | null {
  const stock = stockForMint(pool.quoteMint);
  return stock ? {pool, stock} : null;
}

export function decodeCustomPair(data: Uint8Array): PumpCustomPair | null {
  const pool = decodePumpPool(data);
  return pool ? asCustomPair(pool) : null;
}

/**
 * Whether this coin is stock-paired: true, false, or unknown.
 *
 * Three-state because the three answers are genuinely different. `true` means a
 * verified stock is on the quote side. `false` means a quote mint we recognise
 * and know is not a stock. `null` means a quote mint that is neither — possibly
 * a real tokenized stock from an issuer the registry has not verified, which is
 * a reason to keep showing the coin rather than to hide it.
 */
export function isCustomPair(
  pool: PumpPoolState,
  knownNonStocks: ReadonlySet<string>,
): boolean | null {
  if (stockForMint(pool.quoteMint)) return true;
  if (knownNonStocks.has(pool.quoteMint)) return false;
  return null;
}
