/**
 * The store's read and write layer.
 *
 * Everything that touches `stonks` goes through here, for one reason: the
 * three-state filter and the keyset cursor are easy to get subtly wrong, and a
 * second copy of either drifts. The predecessor app's feed emptied three times
 * from `.eq(flag, true)` written in a new query, so the filter is a function
 * here and `applyThreeStateFilter` is the only way to express it.
 */

import {displayImageUrl} from "@/lib/imageUrl";
import {NEW_FEED_MIN_MCAP_USD} from "@/config/feed";
import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {type Pubkey, assertPubkey} from "@/lib/pubkey";
import {applyThreeStateFilter, isTradeableFromLiquidity} from "@/lib/threeState";
import type {PriceState, Stonk} from "@/lib/types";
import type {QuoteKind} from "@/lib/universe";
import {db, hasDatabase} from "../db";
import {
  hasAdminPg,
  pgReadIndexerState,
  pgUpsertStats,
  pgUpdateStonks,
  pgUpsertStonks,
  pgWriteIndexerState,
} from "../adminPg";

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
  /**
   * How far along its bonding curve, as a fraction in [0, 1].
   *
   * Only meaningful while `status` is `pending`. Null on a graduated coin —
   * it is done, so there is no progress left to report — and null on any coin
   * the graduating sweep has not reached, which is not the same as 0%.
   */
  curve_progress: number | null;
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
  discord: string | null;
  website: string | null;
  listed_at: string | null;
  /**
   * When this app first saw the pool graduated.
   *
   * Distinct from `listed_at`, which is the token's mint date. A token minted
   * ten days ago that bonded twenty minutes ago is the newest thing on the
   * launchpad, and sorting the New feed by mint date buried it.
   */
  graduated_at: string | null;
  /**
   * `curve` for a LaunchLab or pump.fun curve launch, `clmm` for a coin
   * StonkFun opened straight into a CLMM pool. Null only on a row written
   * before the column existed and not yet backfilled.
   */
  pool_kind: "curve" | "clmm" | null;
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

/**
 * A Postgres `numeric`, as a JavaScript number.
 *
 * The two drivers disagree about this and the disagreement is silent. PostgREST
 * returns JSON numbers; node-postgres returns **strings**, because `numeric` is
 * arbitrary precision and a float would not always round-trip. So the same
 * column is `0.627881` on one path and `"0.627881"` on the other, and the
 * string passes every truthiness check on the way to the screen before failing
 * the one that matters.
 *
 * That is not hypothetical twice over. It made the Stonkfolio chart render
 * flat, and then — after that was fixed and commented — it shipped the
 * Graduating tab with every progress bar invisible, because
 * `Number.isFinite("0.627881")` is false. Converting here, at the one boundary
 * both drivers pass through, is the only version of this fix that stays fixed.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    /*
     * An empty string is absence, not zero. `Number("")` is `0` and passes
     * `isFinite`, so without this an unset column renders as a coin at 0% of
     * its curve — a claim about the coin rather than about our data, and one
     * a user has no way to check.
     */
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

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
    curveProgress: num(row.curve_progress),
    listedAt: row.graduated_at ?? row.listed_at,
    // Proxied only where the host throttles; see `displayImageUrl`.
    imageUrl: displayImageUrl(row.image_url),
    decimals: row.decimals,
    circulatingSupply: num(row.circulating_supply),
    socials:
      row.twitter || row.telegram || row.website || row.discord
        ? {
            x: row.twitter,
            telegram: row.telegram,
            website: row.website,
            discord: row.discord,
          }
        : null,
  };
}

export type FeedSort = "trending" | "new" | "marketCap" | "rewards";

export interface FeedQuery {
  sort: FeedSort;
  limit?: number;
  /** Keyset cursor, `graduated_at|mint` for New. Never an offset. */
  cursor?: string | null;
  /**
   * Whether the New sort's market-cap floor applies.
   *
   * On by default, because every *feed* read wants it. The decorate pass does
   * not: it reads this same sort to pick which coins to refresh, and a floor
   * there would mean a coin that fell under $10K could never be re-priced —
   * so it would sit at its last known number forever, which is the one state
   * worse than being hidden.
   */
  applyNewFloor?: boolean;
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

  /*
   * Read the view, not the table.
   *
   * Stats live in their own table so a provider outage cannot remove a coin,
   * which means sorting by one has to cross a join. Doing that in memory over
   * a page ranks whatever arbitrary rows came back rather than the universe —
   * the first live run put a $39K coin above a $7.6M one. `stonk_feed` is a
   * LEFT JOIN, so an unpriced coin is still in the result and simply sorts
   * last.
   */
  let request = db()
    .from("stonk_feed")
    .select("*")
    .eq("status", "listed")
    .not("launchpad", "is", null)
    .limit(limit);

  // The one correct way to filter a three-state flag. Never `.eq(col, true)`.
  request = applyThreeStateFilter(request, "eligible");

  if (query.quoteTicker) request = request.eq("quote_ticker", query.quoteTicker);

  const column = SORT_COLUMNS[query.sort];

  /*
   * The New floor, applied in the query rather than after it.
   *
   * Filtering a page client-side means a page of forty can render as four, and
   * the next cursor still only advances forty — so scrolling appears to stall.
   * Applied here, every page is a full page of rows somebody will actually see.
   *
   * An **unpriced** coin is kept deliberately: a null market cap means the
   * decorate pass has not reached it yet, which is exactly the state of a coin
   * that graduated ninety seconds ago. Hiding it would filter out the newest
   * thing on the launchpad for being new.
   */
  if (query.sort === "new" && query.applyNewFloor !== false) {
    request = request.or(
      `last_mcap.gte.${NEW_FEED_MIN_MCAP_USD},last_mcap.is.null`,
    );
  }

  if (query.sort === "rewards") {
    // Only coins whose launch actually routes rewards. The rest under this
    // heading would imply they pay out and merely have not yet.
    request = request.eq("pays_holders", true);
  }

  request = request
    .order(column, {ascending: false, nullsFirst: false})
    .order("mint", {ascending: false});

  if (query.cursor) {
    const [value, mint] = splitCursor(query.cursor);
    if (value) {
      // PostgREST has no row-value syntax, so this is spelled out: strictly
      // past the cursor, or level with it and a lower mint.
      request = request.or(
        `${column}.lt.${value},and(${column}.eq.${value},mint.lt.${mint})`,
      );
    }
  }

  const {data, error} = await request;
  if (error) throw new Error(`Feed query failed: ${error.message}`);

  const joined = (data ?? []) as (StonkRow & StatRow)[];
  const rows = joined as unknown as StonkRow[];

  // The view already carried the stats, so no second query is needed.
  const stats = new Map<string, StatRow>(joined.map((row) => [row.mint, statFrom(row)]));

  const last = joined[joined.length - 1];
  return {
    rows,
    stats,
    cursor:
      joined.length === limit && last
        ? `${(last as unknown as Record<string, unknown>)[column] ?? ""}|${last.mint}`
        : null,
  };
}

/**
 * The stats half of a `stonk_feed` row.
 *
 * The view is a LEFT JOIN, so every read of it carries both halves in one row
 * and both the feed and search split them the same way. One definition, because
 * two copies drift the moment a stat column is added to one and not the other.
 */
function statFrom(row: StonkRow & StatRow): StatRow {
  return {
    mint: row.mint,
    last_price: row.last_price,
    last_mcap: row.last_mcap,
    liquidity_usd: row.liquidity_usd,
    vol_24h: row.vol_24h,
    price_change_24h: row.price_change_24h,
    rewards_24h_usd: row.rewards_24h_usd,
    price_status: row.price_status,
    price_source: row.price_source,
    priced_at: row.priced_at,
  };
}

/**
 * Which column each sort orders by, in the joined view.
 *
 * `new` reads `graduated_at`, not `listed_at`. `listed_at` is the token's mint
 * date, so ordering by it put a coin minted last month but bonded an hour ago
 * below one minted yesterday that has not moved since — and because the page is
 * cut *before* the client re-sorts, that coin never reached the client at all.
 * The tab looked frozen while the worker was writing new rows every ninety
 * seconds.
 */
const SORT_COLUMNS: Record<FeedSort, string> = {
  new: "graduated_at",
  marketCap: "last_mcap",
  trending: "vol_24h",
  rewards: "rewards_24h_usd",
};

function splitCursor(cursor: string): [string | null, string] {
  const separator = cursor.lastIndexOf("|");
  if (separator < 0) return [null, ""];
  return [cursor.slice(0, separator) || null, cursor.slice(separator + 1)];
}

/**
 * Mints per `.in()` filter.
 *
 * The filter travels in the URL, about 47 characters a mint. A wallet full of
 * airdropped spam holds thousands of them: 500 already failed and 12,797 came
 * back 414 Request-URI Too Large — and because the portfolio treats a failed
 * lookup as "store unavailable", every coin in that wallet vanished with it.
 * A hundred keeps each request near 5 KB.
 */
export const IN_FILTER_CHUNK = 100;
/** How many of those chunked queries run at once. */
const IN_FILTER_CONCURRENCY = 6;

/** Split a list into consecutive slices of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const slices: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    slices.push(items.slice(start, start + size));
  }
  return slices;
}

/** Run `select * where mint in (...)` over any number of mints. */
async function selectByMints<T>(
  table: string,
  mints: readonly string[],
  label: string,
): Promise<T[]> {
  const slices = chunk(mints, IN_FILTER_CHUNK);
  const rows: T[] = [];
  for (const batch of chunk(slices, IN_FILTER_CONCURRENCY)) {
    const results = await Promise.all(
      batch.map((slice) => db().from(table).select("*").in("mint", slice)),
    );
    for (const {data, error} of results) {
      if (error) throw new Error(`${label} failed: ${error.message}`);
      rows.push(...((data ?? []) as T[]));
    }
  }
  return rows;
}

export async function statsFor(mints: string[]): Promise<Map<string, StatRow>> {
  if (mints.length === 0) return new Map();

  const rows = await selectByMints<StatRow>("stonk_stats", mints, "Stats query");
  return new Map(rows.map((row) => [row.mint, row]));
}

export async function findStonk(mint: Pubkey): Promise<{row: StonkRow; stat: StatRow | null} | null> {
  const {data, error} = await db().from("stonks").select("*").eq("mint", mint).maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!data) return null;

  const stats = await statsFor([mint]);
  return {row: data as StonkRow, stat: stats.get(mint) ?? null};
}

/**
 * Several coins at once, by mint.
 *
 * For the portfolio, which starts from what a wallet holds rather than from a
 * page of the feed. Batched rather than a lookup per mint, so a wallet holding
 * thirty coins costs one round trip — and chunked, so one holding thousands of
 * spam tokens still gets an answer instead of a 414.
 *
 * No `status` or `eligible` filter, deliberately. Someone who holds a coin
 * should see it whatever the feed has decided about it — hiding a position
 * because the coin fell out of the universe would be telling them their tokens
 * are gone.
 */
export async function stonksByMints(
  mints: readonly Pubkey[],
): Promise<Map<string, {row: StonkRow; stat: StatRow | null}>> {
  const found = new Map<string, {row: StonkRow; stat: StatRow | null}>();
  if (mints.length === 0) return found;

  const rows = await selectByMints<StonkRow>("stonks", mints, "Holdings lookup");
  const stats = await statsFor(rows.map((row) => row.mint));

  for (const row of rows) {
    found.set(row.mint, {row, stat: stats.get(row.mint) ?? null});
  }

  return found;
}

export async function searchStonks(needle: string, limit = 25): Promise<FeedPageRows> {
  /*
   * Biggest first, and read through the view to make that possible.
   *
   * This used to select from the bare table with no `order by` at all, so
   * Postgres returned whatever the scan reached first and the limit cut an
   * arbitrary twenty-five out of the matches. Searching a ticker with hundreds
   * of coins priced against it showed a near-random handful, dust included,
   * with the obvious answer often missing entirely.
   *
   * Market cap is the ranking because a search for a ticker is a search for the
   * market: the thing somebody means by "TSLA" is the largest coin priced in
   * it, not the newest or the smallest. An unpriced coin sorts last rather than
   * being dropped — it is still a real match, it just cannot be ranked.
   */
  let request = db()
    .from("stonk_feed")
    .select("*")
    .eq("status", "listed")
    .or(`symbol.ilike.%${needle}%,name.ilike.%${needle}%,quote_ticker.ilike.%${needle}%`)
    .order("last_mcap", {ascending: false, nullsFirst: false})
    .order("mint", {ascending: false})
    .limit(limit);

  request = applyThreeStateFilter(request, "eligible");

  const {data, error} = await request;
  if (error) throw new Error(`Search failed: ${error.message}`);

  // The view carries the stats, so the rows come back already priced.
  const joined = (data ?? []) as (StonkRow & StatRow)[];
  const stats = new Map<string, StatRow>(
    joined.map((row) => [row.mint, statFrom(row)]),
  );
  return {rows: joined as unknown as StonkRow[], stats, cursor: null};
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function upsertStonks(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;

  // Assert every mint at the boundary. A bad address that reaches storage is
  // invisible afterwards, because the row simply never matches again.
  for (const write of writes) assertPubkey(write.mint, "stonk mint");

  /**
   * Direct Postgres when it is available, and not only for speed.
   *
   * PostgREST's upsert is `INSERT ... ON CONFLICT`, so every write has to
   * satisfy the insert path even when the row already exists — a metadata-only
   * pass that omits `launchpad` is rejected for violating a NOT NULL column it
   * was never trying to change. The pg path coalesces each optional column
   * against what is stored, so a pass may write only what it knows.
   *
   * This is not hypothetical: the first real indexer run wrote 276 coins and
   * then failed to decorate a single one, with exactly that error.
   */
  if (hasAdminPg) return pgUpsertStonks(writes);

  const {error} = await db()
    .from("stonks")
    .upsert(
      writes.map((write) => ({...write, updated_at: new Date().toISOString()})),
      {onConflict: "mint"},
    );

  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return writes.length;
}

/**
 * Enrich existing coins. Creates nothing.
 *
 * Decoration must never be able to bring a coin into the universe: only the
 * reconciler has proved a launch's attribution from chain state, and a
 * provider's metadata is not evidence a coin exists.
 */
export async function updateStonks(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  for (const write of writes) assertPubkey(write.mint, "stonk mint");

  if (hasAdminPg) return pgUpdateStonks(writes);

  // PostgREST has no bulk update with per-row values, so this is one request
  // per coin. Acceptable because it only runs when no DATABASE_URL is set.
  let updated = 0;
  for (const write of writes) {
    const {mint, ...patch} = write;
    const {error} = await db()
      .from("stonks")
      .update({...patch, updated_at: new Date().toISOString()})
      .eq("mint", mint);
    if (!error) updated += 1;
  }
  return updated;
}

export async function upsertStats(rows: Partial<StatRow>[]): Promise<number> {
  if (rows.length === 0) return 0;
  if (hasAdminPg) return pgUpsertStats(rows);

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
  if (hasAdminPg) {
    const row = await pgReadIndexerState(name);
    return row
      ? {name, last_slot: row.last_slot, slots_behind: null, last_run_at: null, heartbeat_at: row.heartbeat_at}
      : null;
  }

  const {data} = await db().from("indexer_state").select("*").eq("name", name).maybeSingle();
  return (data as IndexerState) ?? null;
}

export async function writeIndexerState(
  name: string,
  patch: Partial<Omit<IndexerState, "name">>,
): Promise<void> {
  if (hasAdminPg) {
    await pgWriteIndexerState(name, {
      last_slot: patch.last_slot,
      slots_behind: patch.slots_behind ?? null,
      heartbeat_at: patch.heartbeat_at ?? null,
    });
    return;
  }

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

export const storeReady = hasDatabase || hasAdminPg;
export {hasDatabase};
