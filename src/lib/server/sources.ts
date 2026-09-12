/**
 * The one seam every API route calls.
 *
 * Routes never talk to a provider directly. That is what makes the
 * store/decorate split enforceable rather than aspirational: this layer decides
 * what exists by reading the store, then asks providers to decorate it, and a
 * provider that is down can only cost decoration. No provider can remove a row
 * or empty a list, because none of them is ever asked what exists.
 */

import {asPubkey, type Pubkey} from "@/lib/pubkey";
import type {Asset, ChartPoint, Stock, Stonk, Timeframe, Trade} from "@/lib/types";
import {snapshotStock, snapshotStonk, snapshotStonks} from "./snapshot";
import {candlesFor, deepestPoolFor, tradesFor} from "./live/gecko";

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

  const stonk = snapshotStonk(mint);
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

export async function fetchTrades(
  kind: string,
  id: string,
): Promise<SourceResult<{trades: Trade[]; pollMs: number}>> {
  const {data: asset} = await fetchAsset(kind, id);
  if (!asset) {
    return {data: {trades: [], pollMs: 12_000}, stale: false, error: "Not listed here."};
  }

  try {
    const pool = await poolForAsset(asset);
    if (!pool) {
      return {
        data: {trades: [], pollMs: 12_000},
        stale: false,
        error: "No pool is trading this yet.",
      };
    }

    const {trades, stale} = await tradesFor(pool, asset.mint);
    // Without a provider key the free tier allows roughly 30 calls a minute, so
    // the tape refreshes every 12s rather than every 4s. Told to the client
    // rather than guessed there.
    return {
      data: {trades, pollMs: process.env.COINGECKO_API_KEY ? 4_000 : 12_000},
      stale,
      error: null,
    };
  } catch (error) {
    return {
      data: {trades: [], pollMs: 12_000},
      stale: true,
      error: (error as Error).message,
    };
  }
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

export function allStonks(): readonly Stonk[] {
  return snapshotStonks().items;
}

export function findStock(ticker: string): Stock | null {
  return snapshotStock(ticker);
}
