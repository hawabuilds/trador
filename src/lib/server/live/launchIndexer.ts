/**
 * The indexer. What fills the store.
 *
 * **Why a reconciler rather than a log tail.** Solana has no `getLogs`: the way
 * to learn what a program owns is `getProgramAccounts`, which returns current
 * state rather than a stream of events. That is a gift — a sweep is idempotent
 * and self-healing, so a missed window costs nothing and there is no cursor
 * that can silently fall behind and strand coins. The cost is that it is
 * expensive, which is what the filters below are for.
 *
 * Two filters make the sweep affordable, and both are server-side:
 *
 *   - `dataSize` + `memcmp` on the platform config, so LaunchLab returns one
 *     launchpad's pools instead of every pool on Solana.
 *   - `dataSlice`, so only the bytes actually decoded come back — 64 of 429
 *     for the census pass.
 *
 * The signature tail exists only to make *new* launches appear quickly between
 * sweeps. It is a latency optimisation, never the source of truth, which is why
 * losing it degrades freshness rather than correctness.
 */

import {
  LAUNCHPAD_POOL,
  PUMPSWAP_POOL,
  PUMP_AMM,
  RAYDIUM_LAUNCHPAD,
  STONKFUN_PLATFORMS,
} from "@/lib/programs";
import {POOL_STATUS, decodeStonkfunLaunch} from "@/lib/launchpad/launchpadPool";
import {decodeCustomPair} from "@/lib/launchpad/pumpPool";
import {encodeBase58, type Pubkey} from "@/lib/pubkey";
import {STOCK_MINTS, stockForMint} from "@/lib/stocks/registry";
import {quoteKindFor, statusFor} from "@/lib/universe";
import {hasAdminPg} from "../adminPg";
import {
  type StonkWrite,
  updateStonks,
  upsertStats,
  upsertStonks,
  writeIndexerState,
} from "./universeStore";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

let rpcCalls = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  rpcCalls += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: rpcCalls, method, params}),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "RPC rate limited."
        : `RPC returned ${response.status}. Public endpoints refuse getProgramAccounts.`,
    );
  }

  const body = (await response.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Gap between pump sweep calls. Zero when a paid RPC removes the limit. */
const PUMP_SWEEP_GAP_MS = process.env.HELIUS_RPC_URL ? 0 : 700;

/**
 * `rpc`, but it waits out a rate limit instead of failing the pass.
 *
 * A throttle mid-sweep would otherwise lose every stock after the one that hit
 * it, and the pass would report a clean partial result — the universe would
 * just be quietly missing coins with no error to explain why.
 */
async function rpcWithRetry<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await rpc<T>(method, params);
    } catch (error) {
      lastError = error as Error;
      if (!/rate limit/i.test(lastError.message)) throw lastError;
      await sleep(1_500 * 2 ** attempt);
    }
  }

  throw lastError ?? new Error("RPC failed.");
}

/** How many coins one full pass will decorate, and in what batch size. */
const DECORATE_CAP = 600;
const DECORATE_BATCH = 120;

const bytes = (base64: string): Uint8Array =>
  Uint8Array.from(Buffer.from(base64, "base64"));

/** A single byte, base58-encoded, for a memcmp on a `u8` field. */
const byteFilter = (value: number) => encodeBase58(Uint8Array.from([value]));

export interface IndexPass {
  launchpad: "stonkfun" | "pumpfun";
  scanned: number;
  stockPaired: number;
  written: number;
  rpcCalls: number;
  slot: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// StonkFun, via Raydium LaunchLab
// ---------------------------------------------------------------------------

/**
 * Every graduated StonkFun launch priced against a verified stock.
 *
 * Graduated only: a coin on a bonding curve has no pool, no real liquidity and
 * no honest price, so it is stored `pending` and hidden. Filtering `status` in
 * the RPC call rather than in code means the sweep transfers a few hundred
 * accounts instead of thirty-six thousand.
 */
export async function indexStonkfun(): Promise<IndexPass> {
  const before = rpcCalls;
  let scanned = 0;
  let stockPaired = 0;
  const writes: StonkWrite[] = [];

  try {
    for (const platform of STONKFUN_PLATFORMS) {
      const accounts = await rpc<{pubkey: string; account: {data: [string, string]}}[]>(
        "getProgramAccounts",
        [
          RAYDIUM_LAUNCHPAD,
          {
            encoding: "base64",
            commitment: "finalized",
            filters: [
              {dataSize: LAUNCHPAD_POOL.SPAN},
              {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platform.platformId}},
              {
                memcmp: {
                  offset: LAUNCHPAD_POOL.STATUS,
                  bytes: byteFilter(POOL_STATUS.TRADE),
                },
              },
            ],
          },
        ],
      );

      scanned += accounts.length;

      for (const entry of accounts) {
        const launch = decodeStonkfunLaunch(bytes(entry.account.data[0]));
        // Arm 1 of the universe test. A launch priced against something we
        // cannot verify is skipped rather than admitted as `other` — under-
        // inclusion is the safe direction.
        if (!launch?.stock) continue;
        stockPaired += 1;

        writes.push({
          mint: launch.pool.baseMint,
          launchpad: "stonkfun",
          pool: entry.pubkey,
          platform_config: platform.platformId,
          config_kind: platform.kind,
          creator: launch.pool.creator,
          quote_mint: launch.pool.quoteMint,
          quote_ticker: launch.stock.ticker,
          quote_kind: quoteKindFor(launch.pool.quoteMint),
          pays_holders: launch.paysHolders,
          reward_stock: launch.paysHolders ? launch.stock.ticker : null,
          status: statusFor({graduated: launch.pool.graduated}),
          /*
           * Written at `finalized`, so this row is as settled as Solana gets
           * and `eligible` can be true rather than null. The null state is for
           * rows the signature tail writes at `confirmed`.
           */
          eligible: true,
        });
      }
    }

    const written = await upsertStonks(writes);
    const slot = await rpc<number>("getSlot", [{commitment: "finalized"}]);
    await writeIndexerState("stonkfun:reconcile", {last_slot: slot, slots_behind: 0});

    return {
      launchpad: "stonkfun",
      scanned,
      stockPaired,
      written,
      rpcCalls: rpcCalls - before,
      slot,
      error: null,
    };
  } catch (error) {
    return {
      launchpad: "stonkfun",
      scanned,
      stockPaired,
      written: 0,
      rpcCalls: rpcCalls - before,
      slot: 0,
      error: (error as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// pump.fun Custom Pairs, via PumpSwap
// ---------------------------------------------------------------------------

/**
 * pump.fun coins priced against a verified stock.
 *
 * One query per stock rather than one sweep of the program, because PumpSwap
 * holds ~147,000 pools and all but a few dozen are SOL-quoted. Asking for the
 * stock side directly turns a 147k-account transfer into 29 small ones.
 *
 * Deliberately **not** filtered by `dataSize`: two account versions are live
 * (301 current, 245 legacy) and they share these offsets, so pinning either
 * size drops most of the program.
 */
export async function indexPumpCustomPairs(): Promise<IndexPass> {
  const before = rpcCalls;
  let scanned = 0;
  const writes: StonkWrite[] = [];

  try {
    for (const [index, stock] of STOCK_MINTS.entries()) {
      /*
       * Pace the sweep. This is 29 getProgramAccounts calls in a row, and the
       * public endpoint rate-limits well before the end of them — the first
       * real run got nine in before being cut off. A Helius key removes the
       * need for this, but the free path has to work too.
       */
      if (index > 0) await sleep(PUMP_SWEEP_GAP_MS);

      const accounts = await rpcWithRetry<{pubkey: string; account: {data: [string, string]}}[]>(
        "getProgramAccounts",
        [
          PUMP_AMM,
          {
            encoding: "base64",
            commitment: "finalized",
            filters: [{memcmp: {offset: PUMPSWAP_POOL.QUOTE_MINT, bytes: stock.mint}}],
          },
        ],
      );

      scanned += accounts.length;

      for (const entry of accounts) {
        const pair = decodeCustomPair(bytes(entry.account.data[0]));
        if (!pair) continue;

        writes.push({
          mint: pair.pool.baseMint,
          launchpad: "pumpfun",
          pool: entry.pubkey,
          creator: pair.pool.coinCreator,
          quote_mint: pair.pool.quoteMint,
          quote_ticker: pair.stock.ticker,
          quote_kind: quoteKindFor(pair.pool.quoteMint),
          // pump.fun has no holder-reward config; creator fees go to the
          // creator, not to holders.
          pays_holders: false,
          // A PumpSwap pool is already the graduated state.
          status: "listed",
          eligible: true,
          // Verified by construction: this row exists because the quote mint
          // matched a registry stock at a confirmed offset.
          is_custom_pair: true,
        });
      }
    }

    const written = await upsertStonks(writes);
    const slot = await rpc<number>("getSlot", [{commitment: "finalized"}]);
    await writeIndexerState("pumpfun:reconcile", {last_slot: slot, slots_behind: 0});

    return {
      launchpad: "pumpfun",
      scanned,
      stockPaired: writes.length,
      written,
      rpcCalls: rpcCalls - before,
      slot,
      error: null,
    };
  } catch (error) {
    return {
      launchpad: "pumpfun",
      scanned,
      stockPaired: 0,
      written: 0,
      rpcCalls: rpcCalls - before,
      slot: 0,
      error: (error as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Metadata and stats
// ---------------------------------------------------------------------------

/**
 * Fill in what the pool accounts cannot say: symbol, name, decimals, supply,
 * price, liquidity, 24h change — and the coin's artwork.
 *
 * Supply is read from the chain rather than taken from a provider, because it
 * is the multiplicand in every market cap on screen. Everything else here is
 * decoration and is allowed to be missing.
 */
export async function decorateStonks(
  mints: Pubkey[],
): Promise<{priced: number; named: number; error: string | null}> {
  if (mints.length === 0) return {priced: 0, named: 0, error: null};

  try {
    const {jupTokens} = await import("./jupTokens");
    const tokens = await jupTokens(mints);

    const stonkWrites: StonkWrite[] = [];
    const statWrites: Parameters<typeof upsertStats>[0] = [];
    let attributionDisagreements = 0;

    for (const mint of mints) {
      const token = tokens.get(mint);
      if (!token) continue;

      // Jupiter's own launchpad label against ours. Ours wins; a disagreement
      // is worth counting rather than silently resolving.
      if (token.launchpad && !["stonkfun", "pumpfun"].includes(token.launchpad)) {
        attributionDisagreements += 1;
      }

      stonkWrites.push({
        mint,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        token_program: token.tokenProgram,
        circulating_supply: token.circSupply,
        // Artwork, already resolved from whichever gateway the creator used.
        image_url: token.icon,
        image_source: token.icon ? "jupiter" : null,
        listed_at: token.createdAt,
      });

      const usd = token.usdPrice;
      const supply = token.circSupply;

      statWrites.push({
        mint,
        last_price: usd,
        // Measured from a real supply, never extrapolated. Jupiter reports its
        // own mcap too; ours is preferred because the supply behind it is the
        // one written on the row, so the two figures cannot diverge.
        last_mcap:
          usd !== null && supply !== null ? usd * supply : token.marketCapUsd,
        liquidity_usd: token.liquidity,
        vol_24h: token.volume24hUsd,
        price_change_24h: token.priceChange24h,
        price_status: usd !== null ? "priced" : "no_pool",
        price_source: usd !== null ? "pool" : null,
        priced_at: new Date().toISOString(),
      });
    }

    if (attributionDisagreements > 0) {
      console.warn(
        `decorate: ${attributionDisagreements} coin(s) where the provider's ` +
          `launchpad disagrees with the pool. Ours stands.`,
      );
    }

    // Update, not upsert: decoration enriches coins the reconciler found and
    // must never be able to create one.
    await updateStonks(stonkWrites);
    await upsertStats(statWrites);

    return {
      priced: statWrites.filter((row) => row.last_price != null).length,
      named: stonkWrites.filter((row) => row.symbol).length,
      error: null,
    };
  } catch (error) {
    return {priced: 0, named: 0, error: (error as Error).message};
  }
}

/** One full pass: discover, then decorate what was found. */
export async function indexAll(): Promise<{
  passes: IndexPass[];
  decorated: {priced: number; named: number; error: string | null};
}> {
  const stonkfun = await indexStonkfun();
  const pumpfun = await indexPumpCustomPairs();

  /**
   * Decorate everything the reconciler found, not just the first page.
   *
   * The token API batches 40 mints per call, so covering a few hundred coins is
   * a handful of requests rather than a fan-out. Capping at one page left two
   * thirds of the universe unnamed and unpriced — rows that exist, render, and
   * show a dash where a price should be.
   */
  const {pgListStonks} = await import("../adminPg");
  const {listStonks} = await import("./universeStore");

  const rows = hasAdminPg
    ? await pgListStonks(DECORATE_CAP)
    : (await listStonks({sort: "new", limit: 100})).rows;

  let named = 0;
  let priced = 0;
  let decorateError: string | null = null;

  for (let i = 0; i < rows.length; i += DECORATE_BATCH) {
    const batch = rows.slice(i, i + DECORATE_BATCH).map((row) => row.mint as Pubkey);
    const result = await decorateStonks(batch);
    named += result.named;
    priced += result.priced;
    // Keep the first error but carry on: one bad batch should not stop the rest
    // of the universe being priced.
    if (result.error && !decorateError) decorateError = result.error;
  }

  const decorated = {named, priced, error: decorateError};

  await writeIndexerState("live-tip", {heartbeat_at: new Date().toISOString()});

  return {passes: [stonkfun, pumpfun], decorated};
}
