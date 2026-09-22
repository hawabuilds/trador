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
import type {
  Asset,
  AssetPageInitial,
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
import {chainTradesFor} from "./live/chainTape";
import {freshCandles, freshTrades, readCoinTape} from "./live/coinTapes";
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
  let stonk = await fromStore(mint);
  if (!stonk) stonk = snapshotStonk(mint);
  if (!stonk) return {data: null, stale: false, error: "Not listed here."};

  // Decorate with live pool figures. If this fails the row is returned exactly
  // as the store has it — which is the whole point of the split.
  try {
    const pool = await deepestPoolFor(mint);
    if (!pool) return {data: stonk, stale: true, error: null};

    return {
      data: {
        ...stonk,
        price:
          pool.priceUsd !== null
            ? {
                usd: pool.priceUsd,
                source: "pool",
                status: "priced",
                at: new Date().toISOString(),
              }
            : stonk.price,
        changePct: pool.changePct24h ?? stonk.changePct,
        liquidityUsd: pool.liquidityUsd ?? stonk.liquidityUsd,
        volume24hUsd: pool.volume24hUsd ?? stonk.volume24hUsd,
        // Recomputed against the fresher price, using the supply that was
        // measured on chain. Never rescaled without a real supply.
        marketCapUsd:
          pool.priceUsd !== null && stonk.circulatingSupply !== null
            ? pool.priceUsd * stonk.circulatingSupply
            : stonk.marketCapUsd,
      },
      stale: false,
      error: null,
    };
  } catch {
    return {data: stonk, stale: true, error: null};
  }
}

/** Which pool to chart. Stocks chart their own deepest pool too. */
async function poolForAsset(asset: Asset): Promise<Pubkey | null> {
  const pool = await deepestPoolFor(asset.mint);
  return pool?.address ?? null;
}

export async function fetchChart(
  kind: string,
  id: string,
  timeframe: Timeframe,
): Promise<SourceResult<{points: ChartPoint[]; timeframe: Timeframe}>> {
  const {data: asset} = await fetchAsset(kind, id);
  if (!asset) {
    return {
      data: {points: [], timeframe},
      stale: false,
      error: "Not listed here.",
    };
  }

  // The worker's copy first: fresh, it is one store read instead of a provider.
  const kept = freshCandles(await readCoinTape(asset.mint), timeframe);
  if (kept) return {data: {points: kept, timeframe}, stale: false, error: null};

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

/**
 * Where a tape came from.
 *
 * `chain` is every fill the pool made, so the chart may rebuild recent candles
 * from it. `provider` is GeckoTerminal's partial view, which is only safe to
 * append after the last indexed candle.
 */
export type TapeSource = "chain" | "provider";

export async function fetchTrades(
  kind: string,
  id: string,
): Promise<SourceResult<{trades: Trade[]; pollMs: number; source: TapeSource}>> {
  const empty = {trades: [] as Trade[], pollMs: 12_000, source: "provider" as TapeSource};
  const {data: asset} = await fetchAsset(kind, id);
  if (!asset) {
    return {data: empty, stale: false, error: "Not listed here."};
  }

  // The worker's copy first. It refreshes every few seconds, so the client
  // polls a little faster than it would a provider-backed tape.
  const kept = freshTrades(await readCoinTape(asset.mint));
  if (kept) {
    return {data: {trades: kept, pollMs: 4_000, source: "chain"}, stale: false, error: null};
  }

  try {
    const pool = await deepestPoolFor(asset.mint);
    if (!pool) {
      return {data: empty, stale: false, error: "No pool is trading this yet."};
    }

    // The chain first; the provider only when the chain cannot answer.
    if (pool.otherMint) {
      try {
        const chain = await chainTradesFor(pool.address, asset.mint, pool.otherMint);
        // An empty tape falls through: the window a page reads reaches back
        // only minutes on a pool busy with routing, and "no trades yet" about
        // a coin that is trading is worse than the provider's partial view.
        if (chain && chain.trades.length > 0) {
          return {
            data: {trades: chain.trades, pollMs: 6_000, source: "chain"},
            stale: chain.stale,
            error: null,
          };
        }
      } catch {
        // Fall through to the provider rather than empty the tape.
      }
    }

    const {trades, stale} = await tradesFor(pool.address, asset.mint);
    // Without a provider key the free tier allows roughly 30 calls a minute, so
    // the tape refreshes every 12s rather than every 4s. Told to the client
    // rather than guessed there.
    return {
      data: {
        trades,
        pollMs: process.env.COINGECKO_API_KEY ? 4_000 : 12_000,
        source: "provider",
      },
      stale,
      error: null,
    };
  } catch (error) {
    return {data: empty, stale: true, error: (error as Error).message};
  }
}

/** Resolves to null instead of waiting past `ms`, or instead of throwing. */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** How long a coin page will wait on its data before rendering without it. */
const PAGE_DATA_BUDGET_MS = 1_500;

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
export async function fetchAssetPageData(
  kind: "stonk" | "stock",
  id: string,
  requested: string | null,
  listedAt: string | null,
): Promise<AssetPageInitial> {
  const at = Date.now();
  const timeframe = defaultChartTimeframe({kind, listedAt, requested});

  const [asset, chart, trades] = await Promise.all([
    within(fetchAsset(kind, id), PAGE_DATA_BUDGET_MS),
    within(fetchChart(kind, id, timeframe), PAGE_DATA_BUDGET_MS),
    within(fetchTrades(kind, id), PAGE_DATA_BUDGET_MS),
  ]);

  return {
    at,
    asset: asset?.data ? {asset: asset.data, stale: asset.stale} : null,
    // Failures are left for the browser to retry rather than rendered in.
    chart:
      chart && !chart.error
        ? {...chart.data, stale: chart.stale, error: null}
        : null,
    trades:
      trades && !trades.error
        ? {
            ...trades.data,
            trades: trades.data.trades.slice(0, PAGE_TRADES),
            stale: trades.stale,
            error: null,
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
  return (await fromStore(mint)) ?? snapshotStonk(mint);
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
