/**
 * GeckoTerminal, for candles, the trade tape and pool stats on Solana.
 *
 * One decision here is worth spelling out, because getting it wrong produces a
 * chart that is confidently upside down.
 *
 * A pool has a base side and a quote side, and which side our coin is on is up
 * to whoever created it. A StonkFun coin priced in STRCx came back as the pool
 * `STRCx / DIVI` — the stock is base, the coin is quote — so the raw OHLCV was
 * around 106, the price of the *stock in the coin*, while the coin itself is
 * worth $0.0077. Both are real numbers; only one is the chart anyone wants.
 *
 * Rather than detect the orientation and invert by hand, every request names
 * the mint (`token=<mint>&currency=usd`) and lets the provider do it. Manual
 * inversion is where this class of bug lives: it works until a pool is created
 * the other way round, and then a chart is wrong without ever being empty.
 */

import type {ChartPoint, Timeframe, Trade} from "@/lib/types";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {STEP_MS, fillCandles} from "@/lib/fillCandles";
import {cached} from "./cache";

const BASE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "solana";

/** A paid key raises the rate limit; everything works without one. */
const API_KEY = process.env.COINGECKO_API_KEY ?? "";
const PRO = Boolean(API_KEY) && process.env.COINGECKO_API_PLAN !== "demo";

async function gecko<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {accept: "application/json"};
  if (API_KEY) headers[PRO ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = API_KEY;

  const response = await fetch(`${BASE}${path}`, {headers, cache: "no-store"});
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Rate limited by the price provider."
        : `Price provider returned ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

export interface PoolInfo {
  address: Pubkey;
  name: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  changePct24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  /** Our coin's USD price as the provider reports it for its side. */
  priceUsd: number | null;
  /**
   * The mint on the other side of the pool.
   *
   * Taken from the pool itself rather than the coin's `quote_mint`: a coin
   * launched against one asset often trades deepest against another once it
   * graduates, and the tape has to know which vault to read.
   */
  otherMint: Pubkey | null;
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

/**
 * The deepest pool trading a mint.
 *
 * Depth rather than recency: a coin often has several pools and the thin ones
 * produce a jagged chart from a handful of fills.
 */
export async function deepestPoolFor(mint: Pubkey): Promise<PoolInfo | null> {
  const {value} = await cached(`pools:${mint}`, 120_000, async () => {
    const body = await gecko<{data?: Record<string, unknown>[]}>(
      `/networks/${NETWORK}/tokens/${mint}/pools`,
    );

    const pools = (body.data ?? [])
      .map((row) => {
        const attributes = (row.attributes ?? {}) as Record<string, unknown>;
        const relationships = (row.relationships ?? {}) as Record<string, unknown>;

        const address = asPubkey(attributes.address);
        if (!address) return null;

        const baseId = String(
          ((relationships.base_token as {data?: {id?: string}})?.data?.id) ?? "",
        );
        // Provider ids are `solana_<mint>`, and the mint is base58 — so this
        // comparison must stay case-sensitive.
        const isBase = baseId === `${NETWORK}_${mint}`;
        const quoteId = String(
          ((relationships.quote_token as {data?: {id?: string}})?.data?.id) ?? "",
        );
        const otherId = isBase ? quoteId : baseId;
        const otherMint = asPubkey(otherId.startsWith(`${NETWORK}_`) ? otherId.slice(NETWORK.length + 1) : null);

        const change = attributes.price_change_percentage as
          | Record<string, unknown>
          | undefined;
        const volume = attributes.volume_usd as Record<string, unknown> | undefined;
        const txns = attributes.transactions as Record<string, unknown> | undefined;
        const day = (txns?.h24 ?? {}) as Record<string, unknown>;

        return {
          address,
          name: String(attributes.name ?? ""),
          liquidityUsd: num(attributes.reserve_in_usd),
          volume24hUsd: num(volume?.h24),
          changePct24h: num(change?.h24),
          buys24h: num(day.buys),
          sells24h: num(day.sells),
          priceUsd: num(
            isBase ? attributes.base_token_price_usd : attributes.quote_token_price_usd,
          ),
          otherMint,
        } satisfies PoolInfo;
      })
      .filter((pool): pool is PoolInfo => pool !== null)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));

    return pools[0] ?? null;
  });

  return value;
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

/** Trador's timeframes mapped onto the provider's bucket + aggregate pairs. */
const BUCKETS: Record<Timeframe, {path: string; aggregate: number; ttlMs: number}> = {
  "1m": {path: "minute", aggregate: 1, ttlMs: 15_000},
  "5m": {path: "minute", aggregate: 5, ttlMs: 30_000},
  "15m": {path: "minute", aggregate: 15, ttlMs: 45_000},
  "1h": {path: "hour", aggregate: 1, ttlMs: 60_000},
  "4h": {path: "hour", aggregate: 4, ttlMs: 120_000},
  "1D": {path: "day", aggregate: 1, ttlMs: 300_000},
};

export interface CandleResult {
  points: ChartPoint[];
  stale: boolean;
}

export async function candlesFor(
  pool: Pubkey,
  mint: Pubkey,
  timeframe: Timeframe,
  limit = 300,
): Promise<CandleResult> {
  const bucket = BUCKETS[timeframe];

  const {value, stale} = await cached(
    `candles:${pool}:${mint}:${timeframe}`,
    bucket.ttlMs,
    async () => {
      const body = await gecko<{
        data?: {attributes?: {ohlcv_list?: number[][]}};
      }>(
        `/networks/${NETWORK}/pools/${pool}/ohlcv/${bucket.path}` +
          `?aggregate=${bucket.aggregate}&limit=${limit}` +
          `&token=${mint}&currency=usd`,
      );

      const rows = body.data?.attributes?.ohlcv_list ?? [];

      const points =
        rows
          .map(([seconds, open, high, low, close]) => ({
            t: seconds * 1000,
            price: close,
            open,
            high,
            low,
          }))
          // The provider returns newest-first; every chart consumer here
          // expects oldest-first.
          .filter((point) => Number.isFinite(point.price) && point.price > 0)
          .sort((a, b) => a.t - b.t);

      /*
       * A bucket with no trade comes back missing, not flat, so the series has
       * holes wherever the coin went quiet. Filled at the last close, which is
       * what the price actually was for that bucket.
       */
      return fillCandles(points, STEP_MS[timeframe] ?? 0);
    },
  );

  return {points: value, stale};
}

// ---------------------------------------------------------------------------
// The tape
// ---------------------------------------------------------------------------

export async function tradesFor(
  pool: Pubkey,
  mint: Pubkey,
): Promise<{trades: Trade[]; stale: boolean}> {
  const {value, stale} = await cached(`trades:${pool}:${mint}`, 12_000, async () => {
    const body = await gecko<{data?: Record<string, unknown>[]}>(
      `/networks/${NETWORK}/pools/${pool}/trades`,
    );

    return (body.data ?? [])
      .map((row) => {
        const a = (row.attributes ?? {}) as Record<string, unknown>;

        const fromMint = String(a.from_token_address ?? "");
        const toMint = String(a.to_token_address ?? "");

        /**
         * Side from the direction of *our* coin, not the provider's `kind`.
         *
         * `kind` is relative to the pool's base token, and our coin is often
         * the quote — so trusting it labels every buy a sell on half the
         * pools. Whether the trader received our mint is unambiguous.
         */
        const received = toMint === mint;
        if (!received && fromMint !== mint) return null;

        const priceUsd = num(received ? a.price_to_in_usd : a.price_from_in_usd);
        const amount = num(received ? a.to_token_amount : a.from_token_amount);
        const txHash = String(a.tx_hash ?? "");
        if (priceUsd === null || amount === null || !txHash) return null;

        const trade: Trade = {
          id: `${txHash}:${String(a.block_number ?? "")}:${received ? "b" : "s"}`,
          side: received ? "buy" : "sell",
          amount,
          amountUsd: num(a.volume_in_usd) ?? 0,
          priceUsd,
          maker: String(a.tx_from_address ?? ""),
          txHash,
          // Resolved against profiles once the social layer is indexed; a
          // handle invented here would be a claim about who traded.
          makerHandle: null,
          at: String(a.block_timestamp ?? new Date().toISOString()),
        };
        return trade;
      })
      .filter((trade): trade is Trade => trade !== null)
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  });

  return {trades: value, stale};
}

// ---------------------------------------------------------------------------
// SOL in dollars, at a moment in the past
// ---------------------------------------------------------------------------

/** The deepest SOL/USDC pool, whose candles price SOL over time. */
const SOL_USD_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/** One call returns up to this many candles. */
const CANDLE_LIMIT = 1000;
/** Minute candles for the last week; hourly beyond it, where a minute is noise. */
const MINUTE_HORIZON_S = 7 * 24 * 3600;

/**
 * Candles per window, keyed on the window's end.
 *
 * Windows are fixed, not centred on the trade, so a wallet with forty trades
 * in one afternoon costs one request rather than forty. A window that ends in
 * the future is still filling in and is cached briefly; a closed one never
 * changes.
 */
async function solWindow(
  bucket: "minute" | "hour",
  windowEnd: number,
): Promise<Array<[number, number]>> {
  const nowS = Date.now() / 1000;
  const {value} = await cached(
    `sol-usd:${bucket}:${windowEnd}`,
    windowEnd > nowS ? 60_000 : 24 * 3600_000,
    async () => {
      const body = await gecko<{data?: {attributes?: {ohlcv_list?: number[][]}}}>(
        `/networks/${NETWORK}/pools/${SOL_USD_POOL}/ohlcv/${bucket}` +
          `?aggregate=1&limit=${CANDLE_LIMIT}&before_timestamp=${Math.min(windowEnd, Math.floor(nowS))}` +
          `&token=${SOL_MINT}&currency=usd`,
      );
      return (body.data?.attributes?.ohlcv_list ?? [])
        .map(([t, , , , close]) => [t, close] as [number, number])
        .filter(([, close]) => Number.isFinite(close) && close > 0)
        .sort((a, b) => a[0] - b[0]);
    },
  );
  return value;
}

/**
 * SOL's USD price at a unix time, or null if no candle reaches it.
 *
 * The close of the candle containing the moment, or the nearest one before it —
 * a quiet minute has no candle, and the last traded price is the price.
 */
export async function solUsdAt(unixSeconds: number): Promise<number | null> {
  const recent = Date.now() / 1000 - unixSeconds < MINUTE_HORIZON_S;
  const bucket = recent ? "minute" : "hour";
  const step = recent ? 60 : 3600;
  // Leave a margin so a moment near a window's start still has earlier candles.
  const span = step * (CANDLE_LIMIT - 100);
  const windowEnd = Math.ceil((unixSeconds + 1) / span) * span;

  const candles = await solWindow(bucket, windowEnd);
  let best: number | null = null;
  for (const [t, close] of candles) {
    if (t > unixSeconds) break;
    best = close;
  }
  return best ?? candles[0]?.[1] ?? null;
}
