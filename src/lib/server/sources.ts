/**
 * The one seam every API route calls.
 *
 * Routes never talk to a provider directly. That is what makes the
 * store/decorate split enforceable rather than aspirational: this layer decides
 * what exists by reading the store, then asks providers to decorate it, and a
 * provider that is down can only cost decoration. No provider can remove a row
 * or empty a list, because none of them is ever asked what exists.
 */

import {cache} from "react";

import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {mergeTradesIntoChart} from "@/lib/chartLive";
import {STEP_MS} from "@/lib/fillCandles";
import type {
  Asset,
  AssetPageInitial,
  AssetResponse,
  ChartPoint,
  FeedPage,
  Stock,
  Stonk,
  Timeframe,
  Trade,
} from "@/lib/types";
import {hasDatabase} from "./db";
import {snapshotStock, snapshotStocks, snapshotStonk, snapshotStonks} from "./snapshot";
import {cached} from "./live/cache";
import {chainTradesFor, mergeTape, TAPE_MAX} from "./live/chainTape";
import {
  type CoinTape,
  freshCandles,
  freshTrades,
  readCoinTape,
} from "./live/coinTapes";
import {candlesFor, deepestPoolFor, tradesFor} from "./live/gecko";
import {findStonk, listStonks, rowToStonk, searchStonks} from "./live/universeStore";

export interface SourceResult<T> {
  data: T;
  /** True when a provider failed and this is the last good value. */
  stale: boolean;
  /** Set when nothing could be loaded at all. */
  error: string | null;
}

/** A stonk or a stock, from the store. */
export async function fetchAsset(
  kind: string,
  id: string,
): Promise<SourceResult<Asset | null>> {
  if (kind === "stock") {
    const stock = snapshotStock(decodeURIComponent(id));
    return {data: stock, stale: false, error: stock ? null : "Not listed here."};
  }

  const mint = asPubkey(id);
  if (!mint) return {data: null, stale: false, error: "Not a valid mint."};

  /**
   * The store first, the snapshot as the floor.
   *
   * The snapshot exists so a fresh clone renders something real, not as a
   * replacement for the database. Once the indexer has run, the store is
   * authoritative and the snapshot stops being consulted — which is why this
   * only falls through on a miss rather than merging the two.
   */
  const core = await assetCore(kind, id);
  if (!core) return {data: null, stale: false, error: "Not listed here."};
  return decorateAsset(core);
}

/** Store or snapshot row, without a provider round trip. */
async function assetCore(kind: string, id: string): Promise<Asset | null> {
  if (kind === "stock") {
    return snapshotStock(decodeURIComponent(id));
  }

  const mint = asPubkey(id);
  if (!mint) return null;

  let stonk = await fromStore(mint);
  if (!stonk) stonk = snapshotStonk(mint);
  return stonk;
}

/** Live pool figures layered onto a store row. */
async function decorateAsset(asset: Asset): Promise<SourceResult<Asset>> {
  try {
    const pool = await deepestPoolFor(asset.mint);
    if (!pool) return {data: asset, stale: true, error: null};

    const price =
      pool.priceUsd !== null
        ? {
            usd: pool.priceUsd,
            source: "pool" as const,
            status: "priced" as const,
            at: new Date().toISOString(),
          }
        : asset.price;

    if (asset.kind === "stock") {
      return {
        data: {
          ...asset,
          price,
          changePct: pool.changePct24h ?? asset.changePct,
        },
        stale: false,
        error: null,
      };
    }

    return {
      data: {
        ...asset,
        price,
        changePct: pool.changePct24h ?? asset.changePct,
        liquidityUsd: pool.liquidityUsd ?? asset.liquidityUsd,
        volume24hUsd: pool.volume24hUsd ?? asset.volume24hUsd,
        marketCapUsd:
          pool.priceUsd !== null && asset.circulatingSupply !== null
            ? pool.priceUsd * asset.circulatingSupply
            : asset.marketCapUsd,
      },
      stale: false,
      error: null,
    };
  } catch {
    return {data: asset, stale: true, error: null};
  }
}

/** Which pool to chart. Stocks chart their own deepest pool too. */
async function poolForAsset(asset: Asset): Promise<Pubkey | null> {
  const pool = await deepestPoolFor(asset.mint);
  return pool?.address ?? null;
}

/** Still on the bonding curve — no graduated AMM pool, but curve buys are real. */
function isOnCurveStonk(asset: Asset): asset is Stonk {
  return asset.kind === "stonk" && asset.status === "pending";
}

async function curveChainTrades(
  stonk: Stonk,
): Promise<{trades: Trade[]; stale: boolean} | null> {
  const tape = await chainTradesFor(stonk.pool, stonk.mint, stonk.quoteMint);
  if (!tape) return null;
  return tape;
}

/** Mint for a route id without decorating from a provider. */
function mintForRoute(kind: string, id: string): Pubkey | null {
  if (kind === "stock") {
    return snapshotStock(decodeURIComponent(id))?.mint ?? null;
  }
  return asPubkey(id);
}

async function fetchChartForAsset(
  asset: Asset,
  timeframe: Timeframe,
  tape: CoinTape | null = null,
): Promise<SourceResult<{points: ChartPoint[]; timeframe: Timeframe}>> {
  const kept = freshCandles(tape ?? (await readCoinTape(asset.mint)), timeframe);
  if (kept) return {data: {points: kept, timeframe}, stale: false, error: null};

  if (isOnCurveStonk(asset)) {
    try {
      const chain = await curveChainTrades(asset);
      if (chain && chain.trades.length > 0) {
        const bucketMs = STEP_MS[timeframe] ?? STEP_MS["5m"];
        const points = mergeTradesIntoChart([], chain.trades, bucketMs, {complete: true});
        return {
          data: {points, timeframe},
          stale: chain.stale,
          error: points.length > 0 ? null : "Not enough curve history yet.",
        };
      }
      return {
        data: {points: [], timeframe},
        stale: chain?.stale ?? false,
        error: chain ? "No curve trades yet." : "Curve history is not configured.",
      };
    } catch (error) {
      return {
        data: {points: [], timeframe},
        stale: true,
        error: (error as Error).message,
      };
    }
  }

  try {
    const pool = await poolForAsset(asset);
    if (!pool) {
      return {
        data: {points: [], timeframe},
        stale: false,
        error: "No pool is trading this yet.",
      };
    }

    const {points, stale} = await candlesFor(pool, asset.mint, timeframe);
    return {data: {points, timeframe}, stale, error: null};
  } catch (error) {
    return {
      data: {points: [], timeframe},
      stale: true,
      error: (error as Error).message,
    };
  }
}

export async function fetchChart(
  kind: string,
  id: string,
  timeframe: Timeframe,
): Promise<SourceResult<{points: ChartPoint[]; timeframe: Timeframe}>> {
  const mint = mintForRoute(kind, id);
  if (mint) {
    const kept = freshCandles(await readCoinTape(mint), timeframe);
    if (kept) {
      return {data: {points: kept, timeframe}, stale: false, error: null};
    }
  }

  const {data: asset} = await fetchAsset(kind, id);
  if (!asset) {
    return {
      data: {points: [], timeframe},
      stale: false,
      error: "Not listed here.",
    };
  }

  return fetchChartForAsset(asset, timeframe);
}

/**
 * Where a tape came from.
 *
 * `chain` is every fill the pool made, so the chart may rebuild recent candles
 * from it. `provider` is GeckoTerminal's partial view, which is only safe to
 * append after the last indexed candle.
 */
export type TapeSource = "chain" | "provider";

export type TradesPayload = {
  trades: Trade[];
  pollMs: number;
  source: TapeSource;
  /** False when older fills were backfilled from the provider. */
  tapeComplete: boolean;
};

const emptyTrades = (): SourceResult<TradesPayload> => ({
  data: {trades: [], pollMs: 12_000, source: "provider", tapeComplete: false},
  stale: false,
  error: null,
});

const providerPollMs = () => (process.env.COINGECKO_API_KEY ? 4_000 : 12_000);

const tradesFromTape = (tape: CoinTape | null): SourceResult<TradesPayload> | null => {
  const kept = freshTrades(tape);
  if (!kept) return null;
  /*
   * Worker/DB tapes are a bounded chain window for display. They are not the
   * live merge that knows whether provider fills were backfilled, so the chart
   * keeps appending until a poll marks the tape complete.
   */
  return {
    data: {trades: kept, pollMs: 4_000, source: "chain", tapeComplete: false},
    stale: false,
    error: null,
  };
};

/** Provider fills that survived a merge — chain did not list them. */
function providerBackfilled(chain: readonly Trade[], merged: readonly Trade[]): boolean {
  const chainSigs = new Set(chain.map((trade) => trade.txHash));
  return merged.some((trade) => !chainSigs.has(trade.txHash));
}

async function fetchTradesForAsset(
  asset: Asset,
  tape: CoinTape | null = null,
  options: {chainFirst?: boolean} = {},
): Promise<SourceResult<TradesPayload>> {
  const empty = emptyTrades();
  const chainFirst = options.chainFirst !== false;

  if (isOnCurveStonk(asset)) {
    try {
      const fromTape = tradesFromTape(
        tape ?? (await readCoinTape(asset.mint, {live: true})),
      );
      if (fromTape) return fromTape;

      const chain = await curveChainTrades(asset);
      if (chain && chain.trades.length > 0) {
        return {
          data: {
            trades: chain.trades,
            pollMs: 4_000,
            source: "chain",
            tapeComplete: false,
          },
          stale: chain.stale,
          error: null,
        };
      }
      return {
        data: empty.data,
        stale: chain?.stale ?? false,
        error: chain ? "No curve trades yet." : "Curve trades are not configured.",
      };
    } catch (error) {
      return {data: empty.data, stale: true, error: (error as Error).message};
    }
  }

  try {
    const pool = await deepestPoolFor(asset.mint);
    if (!pool) {
      return {data: empty.data, stale: false, error: "No pool is trading this yet."};
    }

    // Chain first on live polls — extend the in-process tape so new fills stream
    // in. SSR skips this (chainFirst: false) so the page budget is not spent on
    // RPC while the browser will poll anyway.
    if (chainFirst && pool.otherMint) {
      try {
        const chain = await chainTradesFor(pool.address, asset.mint, pool.otherMint);
        if (chain && chain.trades.length > 0) {
          try {
            const {trades: providerTrades, stale: providerStale} = await tradesFor(
              pool.address,
              asset.mint,
            );
            const merged = mergeTape(chain.trades, providerTrades);
            // A short chain window is not authoritative for redrawing indexed
            // candles — only a full chain page with no provider-only backfill is.
            const tapeComplete =
              !providerBackfilled(chain.trades, merged) &&
              chain.trades.length >= TAPE_MAX;
            return {
              data: {
                trades: merged,
                pollMs: 4_000,
                source: "chain",
                tapeComplete,
              },
              stale: chain.stale || providerStale,
              error: null,
            };
          } catch {
            return {
              data: {
                trades: chain.trades,
                pollMs: 4_000,
                source: "chain",
                tapeComplete: false,
              },
              stale: chain.stale,
              error: null,
            };
          }
        }
      } catch {
        // Fall through to the provider rather than empty the tape.
      }
    }

    const fromTape = tradesFromTape(
      tape ?? (await readCoinTape(asset.mint, {live: true})),
    );
    if (fromTape) return fromTape;

    const {trades, stale} = await tradesFor(pool.address, asset.mint);
    return {
      data: {
        trades,
        pollMs: providerPollMs(),
        source: "provider",
        tapeComplete: false,
      },
      stale,
      error: null,
    };
  } catch (error) {
    return {data: empty.data, stale: true, error: (error as Error).message};
  }
}

export async function fetchTrades(
  kind: string,
  id: string,
): Promise<SourceResult<TradesPayload>> {
  const {data: asset} = await fetchAsset(kind, id);
  if (!asset) {
    return {...emptyTrades(), error: "Not listed here."};
  }

  return fetchTradesForAsset(asset);
}

/** Resolves to null instead of waiting past `ms`, or instead of throwing. */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Store row + tape read — not spent on duplicate provider work. */
const PAGE_CORE_BUDGET_MS = 400;
/** Gecko decoration for the header, in parallel with chart/trades. */
const PAGE_DECORATE_BUDGET_MS = 900;
/** Chart and trades each get their own ceiling so one slow leg does not starve the other. */
const PAGE_SECTION_BUDGET_MS = 1_200;

/**
 * Trades rendered into the page. The feed prefetches every row on screen, and
 * a full 300-fill tape made each of those 100-250KB; the page opens on the
 * newest, and its first poll a few seconds later brings the rest.
 */
const PAGE_TRADES = 60;

/**
 * A coin page's header, chart and trades, read for the server render.
 *
 * The feed prefetches every row's page while it is on screen, so this is
 * usually done before anyone taps, and the tap then shows a finished page.
 * Anything slower than the budget is left out, not waited for: the browser
 * asks for it itself, exactly as it did before, and the work carries on in the
 * background to warm the caches that request will hit.
 *
 * `listedAt` picks the chart's timeframe the same way the page will, so the
 * series read here is the one the page shows rather than a near miss.
 */
/** Header only — store row with optional Gecko decoration, no chart or tape work. */
export async function fetchAssetPageHeader(
  kind: "stonk" | "stock",
  id: string,
): Promise<AssetResponse | null> {
  const core = await within(assetCore(kind, id), PAGE_CORE_BUDGET_MS);
  if (!core) return null;
  const decorated = await within(decorateAsset(core), PAGE_DECORATE_BUDGET_MS);
  return {
    asset: decorated?.data ?? core,
    stale: decorated?.stale ?? false,
  };
}

/** Chart and trades once the header row is known — for streamed SSR sections. */
export async function fetchAssetPageSecondary(
  asset: Asset,
  timeframe: Timeframe,
): Promise<Pick<AssetPageInitial, "chart" | "trades">> {
  const tape = await readCoinTape(asset.mint);
  const tapeChart = freshCandles(tape, timeframe);
  const tapeTrades = freshTrades(tape);

  const chartWork: Promise<SourceResult<{points: ChartPoint[]; timeframe: Timeframe}> | null> =
    tapeChart
      ? Promise.resolve({
          data: {points: tapeChart, timeframe},
          stale: false,
          error: null,
        })
      : within(fetchChartForAsset(asset, timeframe, tape), PAGE_SECTION_BUDGET_MS);

  const tradesWork: Promise<SourceResult<TradesPayload> | null> = tapeTrades
    ? Promise.resolve({
        data: {
          trades: tapeTrades,
          pollMs: 4_000,
          source: "chain" as TapeSource,
          tapeComplete: false,
        },
        stale: false,
        error: null,
      })
    : within(fetchTradesForAsset(asset, tape, {chainFirst: false}), PAGE_SECTION_BUDGET_MS);

  const [chart, trades] = await Promise.all([chartWork, tradesWork]);

  return {
    chart: chart?.data
      ? {
          ...chart.data,
          stale: chart.stale,
          error: chart.data.points.length > 0 ? null : (chart.error ?? null),
        }
      : null,
    trades: trades?.data
      ? {
          ...trades.data,
          trades: trades.data.trades.slice(0, PAGE_TRADES),
          stale: trades.stale,
          error: trades.data.trades.length > 0 ? null : (trades.error ?? null),
        }
      : null,
  };
}

export async function fetchAssetPageData(
  kind: "stonk" | "stock",
  id: string,
  requested: string | null,
  listedAt: string | null,
): Promise<AssetPageInitial> {
  const at = Date.now();
  const timeframe = defaultChartTimeframe({kind, listedAt, requested});

  /*
   * One asset read and one tape read, then chart and trades in parallel.
   * The old shape ran fetchAsset three times and read coin_tapes twice,
   * which often burned the SSR budget on duplicate provider work before
   * trades could render.
   */
  const core = await within(assetCore(kind, id), PAGE_CORE_BUDGET_MS);
  if (!core) {
    return {at, asset: null, chart: null, trades: null};
  }

  const [tape, decorated] = await Promise.all([
    readCoinTape(core.mint),
    within(decorateAsset(core), PAGE_DECORATE_BUDGET_MS),
  ]);

  const assetForSections = decorated?.data ?? core;
  const assetStale = decorated?.stale ?? false;

  const tapeChart = freshCandles(tape, timeframe);
  const tapeTrades = freshTrades(tape);

  const chartWork: Promise<SourceResult<{points: ChartPoint[]; timeframe: Timeframe}> | null> =
    tapeChart
      ? Promise.resolve({
          data: {points: tapeChart, timeframe},
          stale: false,
          error: null,
        })
      : within(fetchChartForAsset(assetForSections, timeframe, tape), PAGE_SECTION_BUDGET_MS);

  const tradesWork: Promise<SourceResult<TradesPayload> | null> = tapeTrades
    ? Promise.resolve({
        data: {
          trades: tapeTrades,
          pollMs: 4_000,
          source: "chain" as TapeSource,
          tapeComplete: false,
        },
        stale: false,
        error: null,
      })
    : within(
        fetchTradesForAsset(assetForSections, tape, {chainFirst: false}),
        PAGE_SECTION_BUDGET_MS,
      );

  const [chart, trades] = await Promise.all([chartWork, tradesWork]);

  return {
    at,
    asset: {asset: assetForSections, stale: assetStale},
    chart: chart?.data
      ? {
          ...chart.data,
          stale: chart.stale,
          error: chart.data.points.length > 0 ? null : (chart.error ?? null),
        }
      : null,
    trades: trades?.data
      ? {
          ...trades.data,
          trades: trades.data.trades.slice(0, PAGE_TRADES),
          stale: trades.stale,
          error: trades.data.trades.length > 0 ? null : (trades.error ?? null),
        }
      : null,
  };
}

/** Everything the chart page needs, in one request. */
export async function fetchAssetBundle(kind: string, id: string, timeframe: Timeframe) {
  const [asset, chart, trades] = await Promise.all([
    fetchAsset(kind, id),
    fetchChart(kind, id, timeframe),
    fetchTrades(kind, id),
  ]);
  return {asset, chart, trades};
}

async function fromStore(mint: Pubkey): Promise<Stonk | null> {
  if (!hasDatabase) return null;
  try {
    // Held for 30s. The chart, the trades and the header each ask for the same
    // coin every few seconds, and the database is two round trips away; the
    // pool figures layered on top are what move, and those refresh separately.
    const {value: found} = await cached(`store-stonk:${mint}`, 30_000, () => findStonk(mint));
    return found ? rowToStonk(found.row, found.stat) : null;
  } catch {
    // A store that errors must not take the asset page down with it.
    return null;
  }
}

/**
 * Does this coin exist, and what is it called?
 *
 * The route handlers use `fetchAsset`, which also decorates with live pool
 * figures — right for rendering, wasteful for a page that only needs to know
 * whether to 404. This is the cheap existence check, and it reads the same two
 * sources in the same order as everything else: **store first, snapshot as the
 * floor.**
 *
 * That ordering is the whole point. The chart page used to test membership
 * against `snapshotStonk` alone — the 140 coins baked into the bundle at build
 * time — while the feed had been switched to read the live store's 336. The
 * 196 coins that existed only in the store rendered rows people could tap and
 * a hard 404 when they did, and the two numbers drifted further apart with
 * every sweep the indexer ran.
 *
 * `cache` dedupes within a request, so `generateMetadata` and the page body
 * cost one lookup between them rather than two.
 */
export const stonkFor = cache(async (id: string): Promise<Stonk | null> => {
  const mint = asPubkey(id);
  if (!mint) return null;
  const known = (await fromStore(mint)) ?? snapshotStonk(mint);
  if (known) return known;

  /*
   * A mint the store has never heard of. The indexer will not list a curve
   * until it is well on its way to graduating, so a coin launched moments ago
   * is invisible here and the page 404s. Ask the chain whether this mint is
   * a launch we would have registered, and if it is, register it now.
   */
  const {registerLaunchByMint} = await import("./live/registerLaunch");
  return registerLaunchByMint(mint);
});

/**
 * The feed.
 *
 * Reads the store when there is one and the snapshot when there is not, and
 * says which — so the UI can label a snapshot rather than presenting captured
 * numbers as live.
 */
export async function fetchFeed(
  sort: "trending" | "new" | "marketCap" | "rewards",
  options: {limit?: number; cursor?: string | null; quoteTicker?: string | null} = {},
): Promise<{
  items: readonly Stonk[];
  cursor: string | null;
  source: "live" | "snapshot";
  capturedAt: string | null;
}> {
  if (hasDatabase) {
    try {
      const page = await listStonks({sort, ...options});
      if (page.rows.length > 0) {
        return {
          items: page.rows.map((row) => rowToStonk(row, page.stats.get(row.mint) ?? null)),
          cursor: page.cursor,
          source: "live",
          capturedAt: null,
        };
      }
      /*
       * An empty *first* page means the indexer has not run yet, not that the
       * universe is empty, so it falls through to the snapshot rather than
       * showing a blank feed.
       *
       * An empty page *past a cursor* means something completely different: it
       * is the end of the list, which is the normal way a keyset walk finishes.
       * Falling through there would answer the last page of the feed with the
       * entire bundled snapshot — every coin again, out of order, ignoring the
       * cursor and the market-cap floor, and duplicating rows the caller is
       * already showing.
       *
       * The bug was dormant for as long as nothing paged: page one is never
       * empty while the store has rows, so the fallback only ever fired when
       * the store really was unreachable.
       */
      if (options.cursor) {
        return {items: [], cursor: null, source: "live", capturedAt: null};
      }
    } catch {
      // A store *error* still falls back rather than emptying the screen —
      // including mid-walk, where a short page is better than a broken one.
    }
  }

  /*
   * The snapshot cannot answer a cursor: it is one bundled list with no
   * ordering guarantee against the store's. Returning it here would restart the
   * feed from the top midway through a scroll, so a paged request that gets
   * this far ends the list instead.
   */
  if (options.cursor) {
    return {items: [], cursor: null, source: "snapshot", capturedAt: null};
  }

  const snapshot = snapshotStonks();
  return {
    items: snapshot.items,
    cursor: null,
    source: "snapshot",
    capturedAt: snapshot.capturedAt,
  };
}

/**
 * Launches still on the curve, nearest to graduating first.
 *
 * Store only, with no snapshot fallback — and that is deliberate. The bundled
 * snapshot holds graduated coins exclusively, so falling through to it would
 * fill a "Graduating" tab with coins that already graduated. An empty list is
 * the honest answer when the store cannot be reached.
 */
export async function fetchGraduating(limit = 60): Promise<readonly Stonk[]> {
  const {hasAdminPg, pgListGraduating} = await import("./adminPg");
  if (!hasAdminPg) return [];

  try {
    const rows = await pgListGraduating(limit);
    const {statsFor} = await import("./live/universeStore");
    const stats = await statsFor(rows.map((row) => row.mint));
    return rows.map((row) => rowToStonk(row, stats.get(row.mint) ?? null));
  } catch {
    return [];
  }
}

export async function searchUniverse(needle: string): Promise<readonly Stonk[]> {
  if (hasDatabase) {
    try {
      const page = await searchStonks(needle);
      if (page.rows.length > 0) {
        return page.rows.map((row) => rowToStonk(row, page.stats.get(row.mint) ?? null));
      }
    } catch {
      // Fall through to the snapshot.
    }
  }

  const lowered = needle.toLowerCase(); // pubkey-lint-ok: a text query, not an address
  return snapshotStonks().items.filter(
    (stonk) =>
      stonk.symbol.toLowerCase().includes(lowered) ||
      stonk.name.toLowerCase().includes(lowered) ||
      stonk.quoteTicker.toLowerCase().includes(lowered),
  );
}

export function allStonks(): readonly Stonk[] {
  return snapshotStonks().items;
}

export function findStock(ticker: string): Stock | null {
  return snapshotStock(ticker);
}

/** Registry list with bundled snapshot prices — no live provider round trip. */
export function feedStocksSnapshot(): FeedPage<Stock> {
  return snapshotStocks();
}

/**
 * The stock list, priced live.
 *
 * `snapshotStocks` builds the list from the registry and prices it from the
 * bundled snapshot — which is frozen at generation time and, since the registry
 * grew from 29 stocks to 82, has no entry at all for most of them. This puts a
 * current price on every one.
 *
 * Failure is a downgrade, not an error: if the provider is unreachable the
 * snapshot's own prices stand, which is exactly what this function is wrapping.
 * A stock still shows a dash only when nobody has ever had a price for it.
 */
export async function fetchStocks(): Promise<FeedPage<Stock>> {
  const page = snapshotStocks();

  try {
    const {stockPrices} = await import("./live/stockPrices");
    const live = await stockPrices(page.items.map((stock) => stock.mint));
    if (live.size === 0) return page;

    return {
      ...page,
      items: page.items.map((stock): Stock => {
        const quote = live.get(stock.mint);
        if (!quote || quote.usd === null) return stock;

        return {
          ...stock,
          /*
           * Labelled `pool`, not `oracle`. This is an aggregate of on-chain
           * venues; the registry's `priceAuthority: "pyth"` describes where the
           * price *should* come from once Pyth is wired, and overstating it
           * here would make that field meaningless.
           */
          price: {
            usd: quote.usd,
            source: "pool" as const,
            status: "priced" as const,
            at: new Date().toISOString(),
          },
          changePct: quote.changePct ?? stock.changePct,
        };
      }),
    };
  } catch {
    return page;
  }
}
