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
import {
  POOL_STATUS,
  curveProgress,
  decodeGraduatingPool,
  decodeStonkfunLaunch,
} from "@/lib/launchpad/launchpadPool";
import {decodeCustomPair} from "@/lib/launchpad/pumpPool";
import {
  CLMM_MINTS_SLICE,
  CLMM_POOL,
  decodeClmmLaunch,
  stonkfunClmmFilters,
} from "@/lib/launchpad/stonkfunClmm";
import {collectLinks} from "./socialLinks";
import {encodeBase58, type Pubkey} from "@/lib/pubkey";
import {STOCK_MINTS, stockForMint} from "@/lib/stocks/registry";
import {computeTrendingScore} from "@/lib/trendingScore";
import {quoteKindFor, statusFor} from "@/lib/universe";
import {hasAdminPg, pgClearCurveProgress} from "../adminPg";
import {
  type StonkWrite,
  statsFor,
  updateStonks,
  upsertStats,
  upsertStonks,
  writeIndexerState,
} from "./universeStore";

import {getProgramAccountsV2All} from "../getProgramAccountsV2";
import {indexerRpcUrl} from "../rpcUrl";

const RPC_URL = indexerRpcUrl();

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
const PUMP_SWEEP_GAP_MS =
  process.env.INDEXER_RPC_URL || process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL
    ? 0
    : 700;

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
/*
 * A thousand per pass: with the direct CLMM launches the universe is several
 * thousand coins, and `pgListStonks` rotates through them stalest-first, so
 * this sets how often the oldest price is refreshed — every few passes — at
 * roughly twenty-five token-API calls.
 */
const DECORATE_CAP = 1000;
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
 * Graduated only, and the `status` filter is in the RPC call rather than in
 * code because the difference is a few hundred accounts against fifty
 * thousand.
 *
 * This comment used to claim a curve coin "is stored `pending` and hidden".
 * It was not — the filter removed those pools before any code could store
 * anything, so `pending` was a status the database had never once held.
 * `indexGraduating` below is what actually stores them, and it is deliberately
 * narrow: the ones close enough to graduating to be worth watching.
 */
export async function indexStonkfun(): Promise<IndexPass> {
  const before = rpcCalls;
  const now = new Date().toISOString();
  let scanned = 0;
  let stockPaired = 0;
  const writes: StonkWrite[] = [];

  try {
    for (const platform of STONKFUN_PLATFORMS) {
      const accounts = await getProgramAccountsV2All(rpcWithRetry, RAYDIUM_LAUNCHPAD, {
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
      });

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
          pool_kind: "curve",
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
           * Stamped on every pass, and kept by the upsert's coalesce.
           *
           * `pgUpsertStonks` writes `coalesce(excluded.col, stonks.col)` for
           * this column, so the *first* sweep that sees a pool graduated is the
           * one that sticks and later passes leave it alone. That makes it
           * "when Trador first saw this graduate" — which is what the New feed
           * wants, and is not `listed_at`, the token's mint date.
           */
          graduated_at: now,
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
    if (hasAdminPg && writes.length > 0) {
      try {
        await pgClearCurveProgress(writes.map((row) => row.mint));
      } catch (error) {
        console.error("clear curve_progress after stonkfun reconcile failed", error);
      }
    }
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
// StonkFun, still on the curve
// ---------------------------------------------------------------------------
// StonkFun, direct CLMM launches
// ---------------------------------------------------------------------------

/**
 * Every coin StonkFun opened straight into a CLMM pool against a verified stock.
 *
 * The curve sweep above cannot see these — there is no LaunchLab pool to find —
 * and there are far more of them than curve launches. See `stonkfunClmm.ts` for
 * how a pool is attributed.
 *
 * One `getProgramAccounts` call, filtered by the RPC on account size and on the
 * pool's creator being StonkFun's launcher, with a 64-byte slice of the two
 * mints. Thousands of pools come back as a few hundred kilobytes.
 *
 * Written `listed` from the start, because a CLMM pool trades from its first
 * block. `graduated_at` is deliberately not stamped here: stamping "now" on the
 * first sweep would put four thousand coins at the top of New as if they had
 * all launched this minute. Decoration fills it from the token's creation time.
 *
 * `pays_holders` is left unknown rather than false. Reward routing is a
 * LaunchLab platform-config feature and there is no config to read here, so
 * "does not pay" would be a claim nobody checked.
 */
export async function indexStonkfunClmm(): Promise<IndexPass> {
  const before = rpcCalls;
  let scanned = 0;
  let stockPaired = 0;
  const writes: StonkWrite[] = [];

  try {
    const accounts = await getProgramAccountsV2All(rpcWithRetry, CLMM_POOL.PROGRAM, {
      encoding: "base64",
      commitment: "finalized",
      dataSlice: CLMM_MINTS_SLICE,
      filters: stonkfunClmmFilters(),
    });

    scanned = accounts.length;

    for (const entry of accounts) {
      const launch = decodeClmmLaunch(entry.pubkey as Pubkey, bytes(entry.account.data[0]));
      if (!launch) continue;
      stockPaired += 1;

      writes.push({
        mint: launch.mint,
        launchpad: "stonkfun",
        pool_kind: "clmm",
        pool: launch.pool,
        quote_mint: launch.quote.mint,
        quote_ticker: launch.quote.ticker,
        quote_kind: quoteKindFor(launch.quote.mint),
        status: "listed",
        eligible: true,
      });
    }

    const written = await upsertStonks(writes);
    const slot = await rpc<number>("getSlot", [{commitment: "finalized"}]);
    await writeIndexerState("stonkfun:clmm", {last_slot: slot, slots_behind: 0});

    return {launchpad: "stonkfun", scanned, stockPaired, written, rpcCalls: rpcCalls - before, slot, error: null};
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

/**
 * How far along a launch must be before it is worth storing.
 *
 * There are ~51,000 StonkFun pools on the curve against ~1,300 graduated, and
 * the overwhelming majority are abandoned within hours of launch. Storing all
 * of them would be a table of dead links; storing none of them was the state
 * this app was in, and it hid every launch during the only window where buying
 * one is interesting.
 *
 * 10% is where a launch has demonstrably found buyers — roughly $800 of the
 * ~$8,200 raise — without being so late that the tab only ever shows coins
 * about to leave it.
 */
const GRADUATING_FLOOR = 0.1;

/**
 * How often the graduating sweep runs, in passes of `indexAll`.
 *
 * At the worker's 90-second cadence this is about fifteen minutes — finer than
 * the thing being measured, since a launch takes hours to move a percentage
 * point. The first pass after a restart always runs, so a cold worker fills the
 * tab immediately rather than leaving it empty for a quarter of an hour.
 */
/** Every Nth `indexAll` pass runs the 88-call graduating sweep. Default 20 ≈ 30 min at 90s. */
const GRADUATING_EVERY = Math.max(
  1,
  Number.parseInt(process.env.GRADUATING_EVERY ?? "20", 10) || 20,
);

let passCount = 0;

/** Guards a single pass against an unexpectedly crowded quote asset. */
const GRADUATING_CAP = 400;

/**
 * Launches on the curve, close enough to graduating to be worth showing.
 *
 * Queried per stock rather than per platform, which is what makes this
 * affordable. A sweep over both platform configs returns every curve pool on
 * StonkFun — fifty thousand accounts, about 22MB — and then throws away the
 * ~56% quoted in SOL, memecoins and wrapped BTC. Filtering on the quote mint
 * instead asks a narrower question 82 times, and `dataSlice` trims each
 * account to the 176 bytes that carry the progress figures, the platform
 * config and the base mint.
 *
 * These rows are written `pending`, which the main feed excludes. They are not
 * tradeable here and carry no price: a curve has no pool, and its seeded
 * virtual reserves are not liquidity. Progress is the only number this surface
 * claims, and it is read straight off the pool.
 */
export async function indexGraduating(): Promise<IndexPass> {
  const before = rpcCalls;
  let scanned = 0;
  let stockPaired = 0;
  const writes: StonkWrite[] = [];

  /*
   * `dataSlice` from the raise through the base mint: offsets 61..236 carry
   * realQuote (61), the target (69), the platform config (173) and mintA
   * (205). The decoder wants a full 429-byte account, so each slice is placed
   * back into a zeroed buffer at its original offset — cheaper than
   * re-implementing the decode against a second layout that could drift.
   */
  const SLICE_FROM = LAUNCHPAD_POOL.REAL_QUOTE;
  const SLICE_TO = LAUNCHPAD_POOL.MINT_B;

  try {
    const platforms = new Set<string>(STONKFUN_PLATFORMS.map((p) => p.platformId));

    for (const stock of STOCK_MINTS) {
      const accounts = await getProgramAccountsV2All(rpcWithRetry, RAYDIUM_LAUNCHPAD, {
        encoding: "base64",
        commitment: "finalized",
        dataSlice: {offset: SLICE_FROM, length: SLICE_TO - SLICE_FROM},
        filters: [
          {dataSize: LAUNCHPAD_POOL.SPAN},
          {memcmp: {offset: LAUNCHPAD_POOL.STATUS, bytes: byteFilter(POOL_STATUS.FUND)}},
          {memcmp: {offset: LAUNCHPAD_POOL.MINT_B, bytes: stock.mint}},
        ],
      });

      scanned += accounts.length;

      for (const entry of accounts) {
        const slice = bytes(entry.account.data[0]);
        const full = new Uint8Array(LAUNCHPAD_POOL.SPAN);
        full.set(slice, SLICE_FROM);

        const pool = decodeGraduatingPool(full);
        if (!pool) continue;

        // The quote came from the filter, but the platform did not — a pool on
        // some other LaunchLab platform is not a StonkFun launch.
        const platform = STONKFUN_PLATFORMS.find((p) => p.platformId === pool.platformId);
        if (!platform || !platforms.has(pool.platformId)) continue;

        const progress = curveProgress(pool);
        if (progress === null || progress < GRADUATING_FLOOR) continue;

        stockPaired += 1;

        writes.push({
          mint: pool.baseMint,
          launchpad: "stonkfun",
          pool_kind: "curve",
          pool: entry.pubkey,
          platform_config: platform.platformId,
          config_kind: platform.kind,
          quote_mint: stock.mint,
          quote_ticker: stock.ticker,
          quote_kind: "stock",
          curve_progress: progress,
          /*
           * Pending, so the main feed does not show it. A curve coin has no
           * pool and therefore no price this app is willing to print beside a
           * graduated one.
           */
          status: "pending",
          eligible: true,
        });
      }

      /*
       * No early break on the cap.
       *
       * Stopping once enough rows are collected would bias the tab toward
       * whichever stocks the registry happens to list first — the coins
       * closest to graduating would be silently dropped because they are
       * quoted in a stock further down the loop. Every stock is scanned and
       * the top rows are taken after sorting, below.
       */
      if (PUMP_SWEEP_GAP_MS > 0) await sleep(PUMP_SWEEP_GAP_MS);
    }

    writes.sort((a, b) => (b.curve_progress ?? 0) - (a.curve_progress ?? 0));
    const top = writes.slice(0, GRADUATING_CAP);

    const written = await upsertStonks(top);

    /*
     * Notify off the back of the same sweep, because it is the only thing that
     * sees both sides.
     *
     * Graduation has no log to subscribe to — the pool's status byte simply
     * reads differently — so it is detected as a diff: a coin the store has as
     * pending that this sweep no longer sees on the curve has finished. Both
     * calls swallow their own failures; a notification must never cost the
     * universe a pass.
     */
    try {
      const {notifyGraduations, notifyNearGraduation} = await import(
        "../notifications/graduationWatch"
      );
      await notifyNearGraduation(
        top.map((row) => ({
          mint: row.mint,
          symbol: row.symbol ?? null,
          progress: row.curve_progress ?? 0,
        })),
      );
      await notifyGraduations(new Set(top.map((row) => row.mint)));
    } catch (error) {
      console.error("graduation notifications failed", error);
    }
    const slot = await rpc<number>("getSlot", [{commitment: "finalized"}]);

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

      const accounts = await getProgramAccountsV2All(rpcWithRetry, PUMP_AMM, {
        encoding: "base64",
        commitment: "finalized",
        filters: [{memcmp: {offset: PUMPSWAP_POOL.QUOTE_MINT, bytes: stock.mint}}],
      });

      scanned += accounts.length;

      for (const entry of accounts) {
        const pair = decodeCustomPair(bytes(entry.account.data[0]));
        if (!pair) continue;

        writes.push({
          mint: pair.pool.baseMint,
          launchpad: "pumpfun",
          pool_kind: "curve",
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
/**
 * Jupiter's two link fields, filed by host rather than by field name.
 *
 * Jupiter reports whatever the creator put in the token metadata, and a creator
 * whose only account is X routinely puts it in `website`. Assigning the fields
 * straight across stores that under `website`, where no surface looking for X
 * will find it. This runs them through the same classifier DexScreener's links
 * go through, so both sources file a link the same way.
 */
function jupiterLinks(token: {twitter?: string | null; website?: string | null}) {
  const links = collectLinks([
    {url: token.twitter, type: "twitter"},
    {url: token.website, type: "website"},
  ]);

  // Spread into the write, so a field Jupiter did not return stays absent and
  // `updateStonks` coalesces rather than blanking what is already stored.
  return {
    ...(links.x ? {twitter: links.x} : {}),
    ...(links.website ? {website: links.website} : {}),
    ...(links.telegram ? {telegram: links.telegram} : {}),
    ...(links.discord ? {discord: links.discord} : {}),
  };
}

export async function decorateStonks(
  mints: Pubkey[],
  /**
   * Which of these are still on a bonding curve.
   *
   * Needed because the provider does not distinguish them and this app must.
   * Jupiter prices a curve coin perfectly well — the curve is a formula, so the
   * price is exact — but it also reports a `liquidity` figure for one, and that
   * figure is the curve's seeded *virtual* reserves. It is not money anyone can
   * trade against, and storing it is how a feed ends up showing fourteen coins
   * with identical five-figure depth.
   */
  onCurve: ReadonlySet<string> = new Set(),
  /**
   * Which of these StonkFun opened straight into a CLMM pool.
   *
   * For those the token's creation *is* the launch — the mint and the pool are
   * made in one transaction — so it is the right value for `graduated_at`. For a
   * curve launch it is exactly the wrong one, which is why this is opt-in by
   * set rather than applied to every coin: that mistake is what once sorted a
   * coin that bonded twenty minutes ago under one minted yesterday.
   */
  direct: ReadonlySet<string> = new Set(),
): Promise<{priced: number; named: number; error: string | null}> {
  if (mints.length === 0) return {priced: 0, named: 0, error: null};

  try {
    const {jupTokens} = await import("./jupTokens");
    const tokens = await jupTokens(mints);
    const existingStats = await statsFor(mints);

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
        // The project's own links. `updateStonks` coalesces, so a later pass
        // that comes back without them cannot blank what is already stored —
        // which matters here because Jupiter's metadata for a given coin comes
        // and goes depending on how recently it was indexed.
        ...jupiterLinks(token),
        listed_at: token.createdAt,
        // Kept-first by the writer, so this fills a blank and never moves one.
        ...(direct.has(mint) && token.createdAt ? {graduated_at: token.createdAt} : {}),
      });

      const usd = token.usdPrice;
      const supply = token.circSupply;
      const curve = onCurve.has(mint);

      const vol1h = token.volume1hUsd;
      const vol24 = token.volume24hUsd;
      const prior = existingStats.get(mint);

      statWrites.push({
        mint,
        last_price: usd,
        // Measured from a real supply, never extrapolated. Jupiter reports its
        // own mcap too; ours is preferred because the supply behind it is the
        // one written on the row, so the two figures cannot diverge.
        last_mcap:
          usd !== null && supply !== null ? usd * supply : token.marketCapUsd,
        // Null on a curve, always. See the note on `onCurve` above.
        liquidity_usd: curve ? null : token.liquidity,
        vol_24h: vol24,
        vol_1h: vol1h,
        txs_24h: token.txs24h,
        unique_makers_24h: token.uniqueMakers24h,
        trending_score: computeTrendingScore({
          vol1hUsd: vol1h,
          vol24hUsd: vol24,
          txs24h: token.txs24h,
          uniqueMakers24h: token.uniqueMakers24h,
          pageViews: prior?.page_views ?? null,
        }),
        price_change_24h: token.priceChange24h,
        price_status: usd !== null ? "priced" : "no_pool",
        /*
         * `curve` is a real price with a different provenance, not a worse
         * one: a bonding curve is a formula, so its price is exact, while a
         * pool mark is whatever the last trade left behind. Labelling them
         * apart is what lets the UI say which it is showing.
         */
        price_source: usd === null ? null : curve ? "curve" : "pool",
        priced_at: new Date().toISOString(),
      });
    }

    if (attributionDisagreements > 0) {
      console.warn(
        `decorate: ${attributionDisagreements} coin(s) where the provider's ` +
          `launchpad disagrees with the pool. Ours stands.`,
      );
    }

    /*
     * Fill what Jupiter did not carry.
     *
     * Jupiter returns `twitter` and `website` for roughly half the universe and
     * never returns telegram or discord at all. DexScreener has the links the
     * creator entered on the pair — a different pile of the same kind of data,
     * overlapping only partly.
     *
     * Asked only about the coins still missing every link after Jupiter, so the
     * set shrinks as the store fills rather than costing a full sweep each
     * pass. A failure yields nothing and the rest of the decoration stands.
     */
    const missingChange = new Set(
      statWrites
        .filter(
          (stat) =>
            stat.mint !== undefined &&
            stat.price_change_24h === null &&
            stat.last_price !== null,
        )
        .map((stat) => stat.mint as string),
    );

    /*
     * Asked about a coin missing *either* piece.
     *
     * Jupiter's `stats24h` omits `priceChange` entirely for about a fifth of
     * the universe — not zero, absent — while still returning price, volume and
     * liquidity for the same coin. Those rows rendered a dash where every
     * neighbour had a percentage, which reads as a broken row rather than as
     * missing data. DexScreener has the number, and it is already being called
     * here for links, so it costs the same request.
     */
    const needFill = stonkWrites
      .filter(
        (write) =>
          !write.twitter ||
          !write.website ||
          !write.image_url ||
          missingChange.has(write.mint),
      )
      .map((write) => write.mint as Pubkey);

    if (needFill.length > 0) {
      try {
        const {dexscreenerFill} = await import("./dexscreener");
        const extra = await dexscreenerFill(needFill);

        for (const write of stonkWrites) {
          const fill = extra.get(write.mint);
          if (!fill) continue;
          // Never overwrite what Jupiter gave; only fill blanks.
          write.twitter = write.twitter ?? fill.links.x ?? null;
          write.website = write.website ?? fill.links.website ?? null;
          write.telegram = write.telegram ?? fill.links.telegram ?? null;
          write.discord = write.discord ?? fill.links.discord ?? null;
          // Only when the token API had none; its artwork is the creator's own.
          if (!write.image_url && fill.imageUrl) {
            write.image_url = fill.imageUrl;
            write.image_source = "dexscreener";
          }
        }

        for (const stat of statWrites) {
          const fill = stat.mint ? extra.get(stat.mint) : undefined;
          if (!fill || fill.priceChange24h === null) continue;
          /*
           * Only the change, and only when ours is missing.
           *
           * Deliberately not liquidity or market cap: DexScreener reports a
           * different set of pairs than the one this row's numbers were
           * measured from, and mixing them would put a market cap and a
           * liquidity figure on the same row that were never true together.
           */
          if (stat.price_change_24h === null) {
            stat.price_change_24h = fill.priceChange24h;
          }
        }
      } catch (error) {
        console.warn("dexscreener fill failed", (error as Error).message);
      }
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
  /** True when at least one listed-coin discovery pass succeeded. */
  discoveryOk: boolean;
}> {
  const stonkfun = await indexStonkfun();
  const direct = await indexStonkfunClmm();
  const pumpfun = await indexPumpCustomPairs();

  /*
   * The graduating sweep runs on its own, slower clock.
   *
   * It costs 82 RPC calls and ~7MB against the 3 calls the graduated sweep
   * needs, because it reads twenty-four thousand curve pools rather than
   * thirteen hundred. At the worker's 90-second cadence that would be ~79,000
   * calls a day to answer a question whose answer barely moves: a launch takes
   * hours to cross a percentage point, and the tab is a watchlist rather than a
   * tape.
   *
   * Every tenth pass is roughly fifteen minutes, which is finer than the thing
   * being measured. `null` on the passes in between, so the caller reports what
   * actually ran instead of a zeroed pass that reads like a failure.
   */
  const graduating = passCount % GRADUATING_EVERY === 0 ? await indexGraduating() : null;
  passCount += 1;

  /**
   * Decorate everything the reconciler found, not just the first page.
   *
   * The token API batches 40 mints per call, so covering a few hundred coins is
   * a handful of requests rather than a fan-out. Capping at one page left two
   * thirds of the universe unnamed and unpriced — rows that exist, render, and
   * show a dash where a price should be.
   */
  const {pgListGraduating, pgListStonks} = await import("../adminPg");
  const {listStonks} = await import("./universeStore");

  /*
   * Graduating rows are decorated alongside listed ones.
   *
   * They need it more, not less: a curve coin has no price to show, so its
   * name and picture are the only things on the row besides a progress bar.
   * The first pass that stored them skipped decoration entirely and produced
   * fifty-six unnamed entries — a tab of blank rows with percentages.
   */
  const listed = hasAdminPg
    ? await pgListStonks(DECORATE_CAP)
    : (
        // No floor: this picks what to *refresh*, and a coin under the feed's
        // market-cap floor still needs its price kept current. Filtering here
        // would freeze it at whatever it was worth when it fell through.
        await listStonks({sort: "new", limit: 100, applyNewFloor: false})
      ).rows;
  const pending = hasAdminPg ? await pgListGraduating(DECORATE_CAP) : [];

  const onCurve = new Set(pending.map((row) => row.mint));
  const directLaunches = new Set(
    listed.filter((row) => row.pool_kind === "clmm").map((row) => row.mint),
  );
  const rows = [...listed, ...pending];

  let named = 0;
  let priced = 0;
  let decorateError: string | null = null;

  for (let i = 0; i < rows.length; i += DECORATE_BATCH) {
    const batch = rows.slice(i, i + DECORATE_BATCH).map((row) => row.mint as Pubkey);
    const result = await decorateStonks(batch, onCurve, directLaunches);
    named += result.named;
    priced += result.priced;
    // Keep the first error but carry on: one bad batch should not stop the rest
    // of the universe being priced.
    if (result.error && !decorateError) decorateError = result.error;
  }

  const decorated = {named, priced, error: decorateError};

  const passes = graduating
    ? [stonkfun, direct, pumpfun, graduating]
    : [stonkfun, direct, pumpfun];

  /*
   * Heartbeat only when discovery actually ran.
   *
   * Decoration can succeed while every getProgramAccounts pass failed — RPC
   * outage, Helius deprioritization, a bad URL. Writing a heartbeat anyway
   * made `/api/cron/index` defer forever to a worker that was only re-pricing
   * stale rows, which is the failure that presents as a feed that simply stops
   * growing.
   */
  const discoveryOk = [stonkfun, direct, pumpfun].some((pass) => !pass.error);
  if (discoveryOk) {
    await writeIndexerState("live-tip", {heartbeat_at: new Date().toISOString()});
  }

  return {passes, decorated, discoveryOk};
}
