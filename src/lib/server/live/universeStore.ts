/**
 * The store's read and write layer.
 *
 * Everything that touches `stonks` goes through here, for one reason: the
 * three-state filter and the keyset cursor are easy to get subtly wrong, and a
 * second copy of either drifts. The predecessor app's feed emptied three times
 * from `.eq(flag, true)` written in a new query, so the filter is a function
 * here and `applyThreeStateFilter` is the only way to express it.
 */

import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {type Pubkey, assertPubkey} from "@/lib/pubkey";
import {applyThreeStateFilter, isTradeableFromLiquidity} from "@/lib/threeState";
import type {PriceState, Stonk} from "@/lib/types";
import type {QuoteKind} from "@/lib/universe";
import {db, hasDatabase} from "../db";

export interface StonkRow {
  mint: string;
  launchpad: "stonkfun" | "pumpfun";
  pool: string | null;
  platform_config: string | null;
  config_kind: "rewards" | "standard" | null;
  creator: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  token_program: string | null;
  quote_mint: string | null;
  quote_ticker: string | null;
  quote_kind: QuoteKind | null;
  pays_holders: boolean | null;
  reward_stock: string | null;
  circulating_supply: number | null;
  status: "pending" | "listed";
  eligible: boolean | null;
  is_tradeable: boolean | null;
  is_custom_pair: boolean | null;
  image_url: string | null;
  /** Where the artwork came from, so a better source can replace a worse one. */
  image_source: string | null;
  image_64: string | null;
  image_128: string | null;
  image_color: string | null;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  listed_at: string | null;
}

export interface StatRow {
  mint: string;
  last_price: number | null;
  last_mcap: number | null;
  liquidity_usd: number | null;
  vol_24h: number | null;
  price_change_24h: number | null;
  rewards_24h_usd: number | null;
  price_status: "priced" | "no_pool" | "failed" | null;
  price_source: "oracle" | "pool" | "curve" | "snapshot" | null;
  priced_at: string | null;
}

export type StonkWrite = Partial<StonkRow> & {mint: string};

/** What a row becomes on screen. One conversion, so surfaces cannot disagree. */
export function rowToStonk(row: StonkRow, stat?: StatRow | null): Stonk {
  const price: PriceState =
    stat?.last_price != null && Number.isFinite(stat.last_price)
      ? {
          usd: stat.last_price,
          source: stat.price_source ?? "pool",
          status: "priced",
          at: stat.priced_at,
        }
      : {
          usd: null,
          source: null,
          // Distinguishes "nothing trades it" from "the provider failed", so
          // the UI can say which rather than rendering $0 for both.
          status: stat?.price_status === "failed" ? "failed" : "no_pool",
          at: stat?.priced_at ?? null,
        };

  return {
    kind: "stonk",
    id: row.mint,
    mint: assertPubkey(row.mint, "stonk mint"),
    pool: assertPubkey(row.pool ?? row.mint, "stonk pool"),
    symbol: row.symbol ?? "",
    name: row.name ?? "",
    launchpad: row.launchpad,
    creator: assertPubkey(row.creator ?? row.mint, "creator"),
    status: row.status,
    quoteMint: assertPubkey(row.quote_mint ?? row.mint, "quote mint"),
    quoteTicker: row.quote_ticker ?? "",
    quoteKind: row.quote_kind ?? "other",
    paysHolders: row.pays_holders ?? false,
    rewards24hUsd: stat?.rewards_24h_usd ?? null,
    price,
    marketCapUsd: stat?.last_mcap ?? null,
    volume24hUsd: stat?.vol_24h ?? null,
    liquidityUsd: stat?.liquidity_usd ?? null,
    isTradeable:
      row.is_tradeable ??
      isTradeableFromLiquidity(stat?.liquidity_usd ?? null, MIN_LIQUIDITY_USD),
    changePct: stat?.price_change_24h ?? null,
    series: [],
    listedAt: row.listed_at,
    imageUrl: row.image_url,
    decimals: row.decimals,
    circulatingSupply: row.circulating_supply,
    socials:
      row.twitter || row.telegram || row.website
        ? {
            x: row.twitter,
            telegram: row.telegram,
            website: row.website,
            discord: null,
          }
        : null,
  };
}

export type FeedSort = "trending" | "new" | "marketCap" | "rewards";

export interface FeedQuery {
  sort: FeedSort;
  limit?: number;
  /** Keyset cursor, `listed_at|mint`. Never an offset. */
  cursor?: string | null;
  quoteTicker?: string | null;
}

export interface FeedPageRows {
  rows: StonkRow[];
  stats: Map<string, StatRow>;
  cursor: string | null;
}

/**
 * One page of the feed.
 *
 * Keyset, not offset: rows arrive constantly, and an offset page re-sorted
 * between two requests both repeats and skips coins. The cursor is the last
 * row's sort key plus its mint, which breaks ties deterministically — and
 * relies on the mint column being `COLLATE "C"`, or the comparison disagrees
 * with the index.
 */
export async function listStonks(query: FeedQuery): Promise<FeedPageRows> {
  const limit = Math.min(Math.max(query.limit ?? 40, 1), 100);

  let request = db()
    .from("stonks")
    .select("*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .limit(limit);

  // The one correct way to filter a three-state flag. Never `.eq(col, true)`.
  request = applyThreeStateFilter(request, "eligible");

  if (query.quoteTicker) request = request.eq("quote_ticker", query.quoteTicker);

  if (query.sort === "new") {
    request = request.order("listed_at", {ascending: false}).order("mint", {ascending: false});

    if (query.cursor) {
      const [listedAt, mint] = splitCursor(query.cursor);
      if (listedAt) {
        // `or` rather than a compound comparison, because PostgREST has no
        // row-value syntax: strictly older, or same instant and a lower mint.
        request = request.or(
          `listed_at.lt.${listedAt},and(listed_at.eq.${listedAt},mint.lt.${mint})`,
        );
      }
    }
  }

  const {data, error} = await request;
  if (error) throw new Error(`Feed query failed: ${error.message}`);

  const rows = (data ?? []) as StonkRow[];
  const stats = await statsFor(rows.map((row) => row.mint));

  /*
   * Sorts that depend on provider figures are applied here rather than in SQL.
   *
   * Stats live in a separate table precisely so a provider outage cannot drop a
   * coin from the universe — which means sorting by market cap in SQL would
   * need a join that silently excludes unpriced rows. Ranking in memory over
   * one page keeps every row in the feed and just puts the unpriced ones last.
   */
  const ranked = rankRows(rows, stats, query.sort);

  const last = ranked[ranked.length - 1];
  return {
    rows: ranked,
    stats,
    cursor:
      ranked.length === limit && last
        ? `${last.listed_at ?? ""}|${last.mint}`
        : null,
  };
}

function splitCursor(cursor: string): [string | null, string] {
  const separator = cursor.lastIndexOf("|");
  if (separator < 0) return [null, ""];
  return [cursor.slice(0, separator) || null, cursor.slice(separator + 1)];
}

function rankRows(
  rows: StonkRow[],
  stats: Map<string, StatRow>,
  sort: FeedSort,
): StonkRow[] {
  const value = (row: StonkRow): number => {
    const stat = stats.get(row.mint);
    switch (sort) {
      case "marketCap":
        return stat?.last_mcap ?? 0;
      case "rewards":
        return stat?.rewards_24h_usd ?? 0;
      case "trending":
        return stat?.vol_24h ?? 0;
      default:
        return 0;
    }
  };

  if (sort === "new") return rows;
  if (sort === "rewards") {
    // Only coins whose launch actually routes rewards. Showing the rest under
    // this heading would imply they pay out and simply have not yet.
    return rows.filter((row) => row.pays_holders).sort((a, b) => value(b) - value(a));
  }
  return [...rows].sort((a, b) => value(b) - value(a));
}

export async function statsFor(mints: string[]): Promise<Map<string, StatRow>> {
  if (mints.length === 0) return new Map();

  const {data, error} = await db().from("stonk_stats").select("*").in("mint", mints);
  if (error) throw new Error(`Stats query failed: ${error.message}`);

  return new Map((data ?? []).map((row) => [(row as StatRow).mint, row as StatRow]));
}

export async function findStonk(mint: Pubkey): Promise<{row: StonkRow; stat: StatRow | null} | null> {
  const {data, error} = await db().from("stonks").select("*").eq("mint", mint).maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!data) return null;

  const stats = await statsFor([mint]);
  return {row: data as StonkRow, stat: stats.get(mint) ?? null};
}

export async function searchStonks(needle: string, limit = 25): Promise<FeedPageRows> {
  let request = db()
    .from("stonks")
    .select("*")
    .eq("status", "listed")
    .or(`symbol.ilike.%${needle}%,name.ilike.%${needle}%,quote_ticker.ilike.%${needle}%`)
    .limit(limit);

  request = applyThreeStateFilter(request, "eligible");

  const {data, error} = await request;
  if (error) throw new Error(`Search failed: ${error.message}`);

  const rows = (data ?? []) as StonkRow[];
  return {rows, stats: await statsFor(rows.map((row) => row.mint)), cursor: null};
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function upsertStonks(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;

  // Assert every mint at the boundary. A bad address that reaches storage is
  // invisible afterwards, because the row simply never matches again.
  for (const write of writes) assertPubkey(write.mint, "stonk mint");

  const {error} = await db()
    .from("stonks")
    .upsert(
      writes.map((write) => ({...write, updated_at: new Date().toISOString()})),
      {onConflict: "mint"},
    );

  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return writes.length;
}

export async function upsertStats(rows: Partial<StatRow>[]): Promise<number> {
  if (rows.length === 0) return 0;

  const {error} = await db()
    .from("stonk_stats")
    .upsert(
      rows.map((row) => ({...row, updated_at: new Date().toISOString()})),
      {onConflict: "mint"},
    );

  if (error) throw new Error(`Stats upsert failed: ${error.message}`);
  return rows.length;
}

export async function replacePools(
  mint: Pubkey,
  pools: {pool: string; quoteMint: string | null; dex: string; liquidityUsd: number | null; isCurve: boolean}[],
): Promise<void> {
  await db().from("stonk_pools").delete().eq("mint", mint);
  if (pools.length === 0) return;

  const {error} = await db()
    .from("stonk_pools")
    .upsert(
      pools.map((pool) => ({
        pool: pool.pool,
        mint,
        quote_mint: pool.quoteMint,
        dex: pool.dex,
        // A curve's seeded reserves are not liquidity, so they are not written
        // as one. See the column comment in the migration.
        liquidity_usd: pool.isCurve ? null : pool.liquidityUsd,
        is_curve: pool.isCurve,
        updated_at: new Date().toISOString(),
      })),
      {onConflict: "pool"},
    );

  if (error) throw new Error(`Pool upsert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------

export interface IndexerState {
  name: string;
  last_slot: number;
  slots_behind: number | null;
  last_run_at: string | null;
  heartbeat_at: string | null;
}

export async function readIndexerState(name: string): Promise<IndexerState | null> {
  const {data} = await db().from("indexer_state").select("*").eq("name", name).maybeSingle();
  return (data as IndexerState) ?? null;
}

export async function writeIndexerState(
  name: string,
  patch: Partial<Omit<IndexerState, "name">>,
): Promise<void> {
  const {error} = await db()
    .from("indexer_state")
    .upsert({name, ...patch, last_run_at: new Date().toISOString()}, {onConflict: "name"});
  if (error) throw new Error(`Cursor write failed: ${error.message}`);
}

export async function universeCount(): Promise<number> {
  const {count} = await db()
    .from("stonks")
    .select("mint", {count: "exact", head: true})
    .eq("status", "listed");
  return count ?? 0;
}

export {hasDatabase};
