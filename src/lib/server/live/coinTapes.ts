/**
 * Kept tapes: each feed coin's trades and default chart, as the worker last
 * read them. See `supabase/migrations/0014_coin_tapes.sql`.
 *
 * The worker writes through direct Postgres when it has it, like the rest of
 * its writes; route handlers read through the service-role client, which is
 * one HTTP call rather than a connection. Either side missing means reads
 * return null and callers go to the providers, so a deployment without the
 * table or without the worker behaves exactly as it did before.
 */

import type {ChartPoint, Timeframe, Trade} from "@/lib/types";
import {withClient, hasAdminPg} from "../adminPg";
import {db, hasDatabase} from "../db";
import {cached} from "./cache";

export interface KeptCandles {
  points: ChartPoint[];
  at: string;
}

export interface CoinTape {
  mint: string;
  pool: string;
  trades: Trade[];
  trades_at: string | null;
  candles: Partial<Record<Timeframe, KeptCandles>>;
}

/** A kept tape older than this is not served; the providers are read instead. */
export const TAPE_FRESH_MS = 30_000;

/** In-process read cache for one page's chart + header (one store read between them). */
export const TAPE_READ_MS = 5_000;
/** Trades polls every few seconds; a long cache here freezes the tape on busy coins. */
export const TAPE_READ_LIVE_MS = 1_000;

/**
 * A kept chart older than this is not served. The worker refreshes a chart
 * every ten minutes to stay inside the CoinGecko plan, and that is enough: the
 * page redraws the candles its trade tape covers, so what is on screen is
 * current even when the stored series is not.
 */
export const CANDLES_FRESH_MS = 15 * 60_000;

/**
 * One coin's kept tape, or null. Held for a second in memory, so the header,
 * chart and trades of one page view cost one read between them.
 */
export async function readCoinTape(
  mint: string,
  options: {live?: boolean} = {},
): Promise<CoinTape | null> {
  if (!hasDatabase) return null;
  const ttlMs = options.live ? TAPE_READ_LIVE_MS : TAPE_READ_MS;
  try {
    const {value} = await cached(`coin-tape:${mint}`, ttlMs, async () => {
      const {data, error} = await db()
        .from("coin_tapes")
        .select("mint, pool, trades, trades_at, candles")
        .eq("mint", mint)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CoinTape | null) ?? null;
    });
    return value;
  } catch {
    // No table yet, or the store is down: fall through to the providers.
    return null;
  }
}

const age = (iso: string | null | undefined) =>
  iso ? Date.now() - Date.parse(iso) : Number.POSITIVE_INFINITY;

/**
 * The kept trades, if they are fresh enough to serve. An empty tape counts as
 * nothing kept: the worker no longer writes one, and a row left empty by an
 * earlier version should send the page to the providers rather than tell
 * someone a trading coin has no trades.
 */
export function freshTrades(tape: CoinTape | null): Trade[] | null {
  if (!tape || !(tape.trades?.length > 0)) return null;
  return age(tape.trades_at) < TAPE_FRESH_MS ? tape.trades : null;
}

/** The kept candles for a timeframe, if fresh enough to serve. */
export function freshCandles(tape: CoinTape | null, timeframe: Timeframe): ChartPoint[] | null {
  const kept = tape?.candles?.[timeframe];
  return kept && age(kept.at) < CANDLES_FRESH_MS ? kept.points : null;
}

export interface CoinTapeWrite {
  mint: string;
  pool: string;
  trades?: Trade[];
  candles?: Partial<Record<Timeframe, KeptCandles>>;
}

/**
 * Upsert a batch. Candles are merged per timeframe rather than replaced, so
 * refreshing one timeframe does not drop another.
 */
export async function writeCoinTapes(writes: CoinTapeWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const now = new Date().toISOString();

  if (hasAdminPg) {
    await withClient(async (client) => {
      for (const write of writes) {
        await client.query(
          `insert into public.coin_tapes (mint, pool, trades, trades_at, candles, updated_at)
           values ($1, $2, coalesce($3::jsonb, '[]'::jsonb), $4::timestamptz, coalesce($5::jsonb, '{}'::jsonb), $6::timestamptz)
           on conflict (mint) do update set
             pool = excluded.pool,
             trades = case when $3::jsonb is null then coin_tapes.trades else excluded.trades end,
             trades_at = coalesce($4::timestamptz, coin_tapes.trades_at),
             candles = coin_tapes.candles || coalesce($5::jsonb, '{}'::jsonb),
             updated_at = excluded.updated_at`,
          [
            write.mint,
            write.pool,
            write.trades ? JSON.stringify(write.trades) : null,
            write.trades ? now : null,
            write.candles ? JSON.stringify(write.candles) : null,
            now,
          ],
        );
      }
    });
    return;
  }

  if (!hasDatabase) return;
  // PostgREST cannot merge jsonb in an upsert, so read the candles held first.
  const {data: held} = await db()
    .from("coin_tapes")
    .select("mint, candles")
    .in("mint", writes.map((write) => write.mint));
  const heldCandles = new Map(
    ((held ?? []) as {mint: string; candles: CoinTape["candles"]}[]).map((row) => [row.mint, row.candles]),
  );
  const {error} = await db()
    .from("coin_tapes")
    .upsert(
      writes.map((write) => ({
        mint: write.mint,
        pool: write.pool,
        ...(write.trades ? {trades: write.trades, trades_at: now} : {}),
        candles: {...(heldCandles.get(write.mint) ?? {}), ...(write.candles ?? {})},
        updated_at: now,
      })),
      {onConflict: "mint"},
    );
  if (error) throw new Error(`Tape write failed: ${error.message}`);
}
