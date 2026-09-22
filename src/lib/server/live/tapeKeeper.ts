/**
 * Keeps the trade tape and default chart of the coins people are most likely
 * to open, so a coin page reads them from the store instead of waiting on
 * Helius and CoinGecko.
 *
 * Runs in the worker, which matters for two reasons. It is one long-lived
 * process, so each coin's tape stays in memory between rounds and a round only
 * reads what happened since the last one — a signature list and, on a busy
 * coin, one parse call. And it is the only process doing it, so each fill is
 * parsed once rather than once per server that happens to be asked.
 *
 * The busiest coins are refreshed every round and the rest every third, which
 * keeps the whole set inside the RPC plan's rate limit.
 */

import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import type {Timeframe} from "@/lib/types";
import {snapshotStocks} from "../snapshot";
import {chainTradesFor} from "./chainTape";
import {writeCoinTapes, type CoinTapeWrite} from "./coinTapes";
import {candlesFor, deepestPoolFor} from "./gecko";
import {NEW_FEED_MIN_MCAP_USD} from "@/config/feed";
import {hasAdminPg, pgFeedHead} from "../adminPg";
import {listStonks, type StonkRow} from "./universeStore";

interface HotCoin {
  mint: Pubkey;
  kind: "stonk" | "stock";
  listedAt: string | null;
  /** Refreshed every round rather than every third. */
  busy: boolean;
}

const TRENDING = 40;
const NEWEST = 20;
const BUSY_TRENDING = 20;
const BUSY_NEWEST = 10;
const BUSY_STOCKS = 10;

/** Coins read at once. The RPC plan refuses bursts much wider than this. */
const CONCURRENCY = 3;

/*
 * CoinGecko is metered monthly (500k calls on the Analyst plan, shared with
 * the app), and the first version of this spent that in days: pools for every
 * coin every two minutes, candles every few rounds. So:
 *
 * - A pool's address is re-read every six hours. It almost never changes, and
 *   the tape only needs the address and the other side's mint.
 * - Candles are kept for the busiest coins only, every ten minutes each. The
 *   page redraws the recent candles from the trade tape, so a chart that old
 *   still ends on the latest trade.
 *
 * About 6k calls a day between them.
 */
const POOL_TTL_MS = 6 * 60 * 60_000;
const CANDLE_EVERY_MS = 10 * 60_000;
const candlesAt = new Map<string, number>();

/** The hot set is re-read from the feed this often, not every round. */
const HOT_SET_TTL_MS = 60_000;

let hotSet: HotCoin[] = [];
let hotSetAt = 0;
let round = 0;

async function readHotSet(): Promise<HotCoin[]> {
  if (Date.now() - hotSetAt < HOT_SET_TTL_MS && hotSet.length > 0) return hotSet;

  // The worker holds only the database URL, so it reads the feed directly;
  // anywhere else, through the same query the feed uses.
  const head = (sort: "trending" | "new", limit: number): Promise<StonkRow[]> =>
    hasAdminPg
      ? pgFeedHead(sort, limit, NEW_FEED_MIN_MCAP_USD)
      : listStonks({sort, limit}).then((page) => page.rows);
  const [trending, newest] = await Promise.all([head("trending", TRENDING), head("new", NEWEST)]);

  const coins = new Map<string, HotCoin>();
  const add = (mint: string | null | undefined, coin: Omit<HotCoin, "mint">) => {
    const key = asPubkey(mint ?? null);
    if (!key) return;
    const held = coins.get(key);
    coins.set(key, {mint: key, ...coin, busy: coin.busy || Boolean(held?.busy)});
  };

  trending.forEach((row, rank) =>
    add(row.mint, {
      kind: "stonk",
      listedAt: row.graduated_at ?? row.listed_at,
      busy: rank < BUSY_TRENDING,
    }),
  );
  newest.forEach((row, rank) =>
    add(row.mint, {
      kind: "stonk",
      listedAt: row.graduated_at ?? row.listed_at,
      busy: rank < BUSY_NEWEST,
    }),
  );
  snapshotStocks().items.forEach((stock, rank) =>
    add(stock.mint, {kind: "stock", listedAt: null, busy: rank < BUSY_STOCKS}),
  );

  hotSet = [...coins.values()];
  hotSetAt = Date.now();
  return hotSet;
}

/**
 * One coin's refresh. Trades and candles fail independently, so a refused
 * provider on one side still lets the other be written; the first error is
 * reported only when nothing could be.
 */
async function keepOne(coin: HotCoin): Promise<CoinTapeWrite | null> {
  const pool = await deepestPoolFor(coin.mint, POOL_TTL_MS);
  if (!pool) return null;

  const write: CoinTapeWrite = {mint: coin.mint, pool: pool.address};
  const errors: unknown[] = [];

  if (pool.otherMint) {
    try {
      const tape = await chainTradesFor(pool.address, coin.mint, pool.otherMint);
      // A stale tape is the last good one after a failed refresh; not worth
      // re-stamping as fresh.
      if (tape && !tape.stale) write.trades = tape.trades;
    } catch (error) {
      errors.push(error);
    }
  }

  if (coin.busy && Date.now() - (candlesAt.get(coin.mint) ?? 0) >= CANDLE_EVERY_MS) {
    // Marked before the call, so a failing coin waits its turn rather than
    // being retried every round.
    candlesAt.set(coin.mint, Date.now());
    try {
      const timeframe: Timeframe = defaultChartTimeframe({kind: coin.kind, listedAt: coin.listedAt});
      const {points, stale} = await candlesFor(pool.address, coin.mint, timeframe);
      if (!stale && points.length > 0) {
        write.candles = {[timeframe]: {points, at: new Date().toISOString()}};
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (write.trades || write.candles) return write;
  if (errors.length > 0) throw errors[0];
  return null;
}

export interface KeepResult {
  coins: number;
  written: number;
  failed: number;
  firstError: string | null;
}

/** One round: refresh what is due, then write it in one batch. */
export async function keepTapes(): Promise<KeepResult> {
  const coins = await readHotSet();
  round += 1;
  const due = coins.filter((coin) => coin.busy || round % 3 === 0);

  const writes: CoinTapeWrite[] = [];
  let failed = 0;
  let firstError: string | null = null;

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const settled = await Promise.allSettled(
      due.slice(i, i + CONCURRENCY).map((coin) => keepOne(coin)),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        if (result.value) writes.push(result.value);
      } else {
        failed += 1;
        firstError ??= (result.reason as Error)?.message ?? String(result.reason);
      }
    }
  }

  await writeCoinTapes(writes);
  return {coins: due.length, written: writes.length, failed, firstError};
}
