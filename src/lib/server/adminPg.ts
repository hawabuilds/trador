/**
 * Direct Postgres, for the indexer, the worker and the scripts.
 *
 * The app runtime reads through PostgREST because serverless functions must not
 * hold connections. Batch work is the opposite case: the indexer writes
 * hundreds of rows at a time, and PostgREST caps rows, times out on large
 * upserts and needs a service-role JWT that a script has no other use for.
 *
 * So there are two drivers on purpose, split by workload rather than by
 * accident — and this one needs only `DATABASE_URL`, which is the single
 * credential a migration already required. That is the difference between
 * "clone, set one variable, index" and "clone, visit a dashboard, copy a JWT,
 * then index".
 *
 * The SQL here is the only place the store's rules are written twice, so each
 * one carries a note pointing at its PostgREST twin.
 */

import type {Pool, PoolClient} from "pg";

import {NEW_FEED_RECENCY_MS, TRENDING_MIN_MCAP_USD} from "@/config/feed";
import type {StatRow, StonkRow, StonkWrite} from "./live/universeStore";

const URL = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

export const hasAdminPg = Boolean(URL);

/**
 * Direct Postgres from Vercel serverless.
 *
 * `DATABASE_URL` on a Next deployment opens a `pg` pool per concurrent
 * invocation and exhausts Supabase; a stale URL also breaks Stonkfolio reads
 * that touch the wallet cache. PostgREST (`hasDatabase`) is the app path.
 */
export const useDirectPg = hasAdminPg && process.env.VERCEL !== "1";

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (!hasAdminPg) {
    throw new Error("No DATABASE_URL. Guard with `hasAdminPg` first.");
  }

  if (!pool) {
    const {default: pg} = await import("pg");
    pool = new pg.Pool({
      connectionString: URL,
      // Supabase terminates unencrypted connections, and the direct host
      // presents a certificate this client has no local root for.
      ssl: {rejectUnauthorized: false},
      /*
       * Small on purpose, because the same code runs in two very different
       * places and the pool size has to be safe in the worse one.
       *
       * The worker is one long-lived process and could hold more. A Vercel
       * function is one process *per concurrent request*, so a pool of 20 there
       * is 20 × concurrency connections against a database that caps out in the
       * low hundreds. Four is plenty for both.
       *
       * What makes the serverless side safe is the URL rather than the number:
       * Vercel points at Supabase's **transaction** pooler (port 6543), which
       * hands a connection back after every statement instead of holding it for
       * the life of the client. Railway's worker points at the **session**
       * pooler (5432), which keeps one — right for a process that runs for
       * weeks, wrong for a function that runs for 200ms. See RAILWAY.md.
       */
      max: 4,
      idleTimeoutMillis: 10_000,
    });
  }

  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await getPool()).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closeAdminPg(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Columns an upsert is allowed to touch. Anything else is ignored. */
const STONK_COLUMNS = [
  "mint",
  "launchpad",
  "pool",
  "platform_config",
  "config_kind",
  "creator",
  "symbol",
  "name",
  "decimals",
  "token_program",
  "quote_mint",
  "quote_ticker",
  "quote_kind",
  "pays_holders",
  "reward_stock",
  "circulating_supply",
  "status",
  "eligible",
  "is_tradeable",
  "is_custom_pair",
  "curve_progress",
  "graduated_at",
  "image_url",
  "image_source",
  "twitter",
  "telegram",
  "website",
  "discord",
  "listed_at",
  "pool_kind",
] as const;

/**
 * Upsert coins.
 *
 * `coalesce(excluded.col, stonks.col)` on every optional column, so a pass that
 * knows less than a previous one cannot erase what is already stored. The
 * reconcile pass writes attribution and no metadata; the decorate pass writes
 * metadata and no attribution. Without the coalesce they would take turns
 * blanking each other's work, and the feed would flicker between named and
 * unnamed rows with nothing in the logs to explain it.
 *
 * `mint`, `launchpad` and `status` are excluded from that rule: those are
 * always known by whoever writes a row, and a null there means a bug worth
 * seeing rather than a value worth preserving.
 */
export async function pgUpsertStonks(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;

  const columns = STONK_COLUMNS.filter((column) =>
    writes.some((write) => (write as Record<string, unknown>)[column] !== undefined),
  );

  const values: unknown[] = [];
  const tuples = writes.map((write, row) => {
    const placeholders = columns.map((column, index) => {
      values.push((write as Record<string, unknown>)[column] ?? null);
      return `$${row * columns.length + index + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const preserved = columns.filter(
    (column) => !["mint", "launchpad", "status"].includes(column),
  );

  /*
   * `graduated_at` keeps the **earliest** real time, not the newest write.
   *
   * The reconciler still stamps `now` when it first sees a TRADE pool — that
   * is right for a live graduation caught within one sweep, and wrong for a
   * gap-fill that discovers coins which graduated hours or days ago. A later
   * decorate pass can supply the pool's open time (DexScreener pairCreatedAt);
   * LEAST lets that earlier stamp replace the indexer-write time, and never
   * lets a fresher `now` pull an already-corrected coin forward again.
   *
   * Every other optional column uses `coalesce(excluded, stored)` so a later
   * pass that knows more can fill a blank.
   */
  const earliestWins = new Set(["graduated_at"]);

  const sql = `
    insert into public.stonks (${columns.join(", ")})
    values ${tuples.join(", ")}
    on conflict (mint) do update set
      ${["launchpad", "status"]
        .filter((column) => columns.includes(column as (typeof STONK_COLUMNS)[number]))
        .map((column) => `${column} = excluded.${column}`)
        .concat(
          preserved.map((column) =>
            earliestWins.has(column)
              ? `${column} = case
                  when excluded.${column} is null then public.stonks.${column}
                  when public.stonks.${column} is null then excluded.${column}
                  else least(public.stonks.${column}, excluded.${column})
                end`
              : `${column} = coalesce(excluded.${column}, public.stonks.${column})`,
          ),
        )
        .join(",\n      ")},
      updated_at = now()
  `;

  return withClient(async (client) => {
    await client.query(sql, values);
    return writes.length;
  });
}

/**
 * Postgres types for the columns an update writes.
 *
 * An `UPDATE ... FROM (VALUES ...)` gives the planner no column context, so a
 * bare placeholder is inferred as `text` and `coalesce(v.decimals, s.decimals)`
 * fails with "types text and smallint cannot be matched". An INSERT does not
 * have this problem, which is why the upsert above needs no casts and this
 * does.
 */
const COLUMN_TYPES: Record<string, string> = {
  decimals: "smallint",
  circulating_supply: "numeric",
  pays_holders: "boolean",
  eligible: "boolean",
  is_tradeable: "boolean",
  is_custom_pair: "boolean",
  curve_progress: "numeric",
  graduated_at: "timestamptz",
  listed_at: "timestamptz",
};

const castFor = (column: string): string => COLUMN_TYPES[column] ?? "text";

/**
 * Enrich rows that already exist. Never create one.
 *
 * This is an UPDATE rather than an upsert, and the distinction is not
 * cosmetic. Postgres checks NOT NULL while forming the tuple, *before* the
 * unique violation that would trigger `ON CONFLICT` — so a metadata-only
 * upsert that omits `launchpad` fails outright even when the row is already
 * there and the insert was never going to happen. No amount of coalescing in
 * the conflict clause rescues it, which cost two indexer runs to work out.
 *
 * It is also the better invariant. Only the reconciler may create a coin,
 * because only the reconciler has proved its attribution from chain state. A
 * decoration pass that could insert would be able to invent a coin out of a
 * provider's metadata, which is exactly backwards.
 */
export async function pgUpdateStonks(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;

  const columns = STONK_COLUMNS.filter(
    (column) =>
      column !== "mint" &&
      writes.some((write) => (write as Record<string, unknown>)[column] !== undefined),
  );

  if (columns.length === 0) return 0;

  /*
   * One statement for the whole batch, via a VALUES list joined on mint.
   *
   * Every placeholder carries an explicit cast — see COLUMN_TYPES. Without
   * them a column that is entirely null in this batch has no inferable type,
   * and one whose real type is not text fails the coalesce outright.
   */
  const values: unknown[] = [];
  const tuples = writes.map((write, row) => {
    const cells = ["mint", ...columns].map((column, index) => {
      values.push((write as Record<string, unknown>)[column] ?? null);
      return `$${row * (columns.length + 1) + index + 1}::${castFor(column)}`;
    });
    return `(${cells.join(", ")})`;
  });

  const sql = `
    update public.stonks as s set
      ${columns
        // Same earliest-wins rule as the upsert: decoration may fill a blank
        // `graduated_at` or pull it earlier toward the real graduation time,
        // but must never make a coin look younger than what is already stored.
        .map((column) =>
          column === "graduated_at"
            ? `${column} = case
                when v.${column} is null then s.${column}
                when s.${column} is null then v.${column}
                else least(s.${column}, v.${column})
              end`
            : `${column} = coalesce(v.${column}, s.${column})`,
        )
        .join(", ")},
      updated_at = now()
    from (values ${tuples.join(", ")}) as v(mint, ${columns.join(", ")})
    where s.mint = v.mint
  `;

  return withClient(async (client) => {
    const result = await client.query(sql, values);
    return result.rowCount ?? 0;
  });
}

const STAT_COLUMNS = [
  "mint",
  "last_price",
  "last_mcap",
  "liquidity_usd",
  "vol_24h",
  "vol_1h",
  "txs_24h",
  "unique_makers_24h",
  "trending_score",
  "price_change_24h",
  "rewards_24h_usd",
  "price_status",
  "price_source",
  "priced_at",
] as const;

export async function pgUpsertStats(rows: Partial<StatRow>[]): Promise<number> {
  if (rows.length === 0) return 0;

  const columns = STAT_COLUMNS.filter((column) =>
    rows.some((row) => (row as Record<string, unknown>)[column] !== undefined),
  );

  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const placeholders = columns.map((column, column_index) => {
      values.push((row as Record<string, unknown>)[column] ?? null);
      return `$${index * columns.length + column_index + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });

  const sql = `
    insert into public.stonk_stats (${columns.join(", ")})
    values ${tuples.join(", ")}
    on conflict (mint) do update set
      ${columns
        .filter((column) => column !== "mint")
        .map((column) => `${column} = excluded.${column}`)
        .join(",\n      ")},
      updated_at = now()
  `;

  return withClient(async (client) => {
    await client.query(sql, values);
    return rows.length;
  });
}

export async function pgWriteIndexerState(
  name: string,
  patch: {last_slot?: number; slots_behind?: number | null; heartbeat_at?: string | null},
): Promise<void> {
  await withClient((client) =>
    client.query(
      `insert into public.indexer_state (name, last_slot, slots_behind, heartbeat_at, last_run_at)
       values ($1, coalesce($2, 0), $3, $4, now())
       on conflict (name) do update set
         last_slot = coalesce(excluded.last_slot, public.indexer_state.last_slot),
         slots_behind = excluded.slots_behind,
         heartbeat_at = coalesce(excluded.heartbeat_at, public.indexer_state.heartbeat_at),
         last_run_at = now()`,
      [name, patch.last_slot ?? null, patch.slots_behind ?? null, patch.heartbeat_at ?? null],
    ),
  );
}

const BY_MINT_TABLES = ["stonks", "stonk_stats"] as const;

/**
 * `select * where mint in (...)` for the worker, which has `DATABASE_URL` and
 * no PostgREST keys. `statsFor` / holdings lookups used to call `db()` here
 * and throw "No database configured" on Railway.
 */
export async function pgSelectByMints<T>(
  table: (typeof BY_MINT_TABLES)[number],
  mints: readonly string[],
): Promise<T[]> {
  if (mints.length === 0) return [];
  if (!(BY_MINT_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Refusing to select from ${table}.`);
  }
  return withClient(async (client) => {
    const {rows} = await client.query(`select * from public.${table} where mint = any($1::text[])`, [
      mints,
    ]);
    return rows as T[];
  });
}

export async function pgReadIndexerState(
  name: string,
): Promise<{last_slot: number; heartbeat_at: string | null} | null> {
  return withClient(async (client) => {
    const {rows} = await client.query(
      "select last_slot, heartbeat_at from public.indexer_state where name = $1",
      [name],
    );
    return rows[0] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Listed coins, newest first.
 *
 * `eligible is distinct from false` — the three-state rule, matching the
 * partial index exactly so the planner can use it. Writing `and eligible` here
 * would both lose the index and hide every unevaluated row. Its PostgREST twin
 * is `applyThreeStateFilter` in `universeStore`.
 */
/**
 * A page of listed coins for the decorate pass, **undecorated first**.
 *
 * The order is the whole point. This used to read `listed_at desc nulls last`,
 * which starved precisely the rows that needed decorating: a freshly graduated
 * coin has no `listed_at` until the decorate pass gives it one, so it sorted
 * last, fell outside the cap, and could never be decorated. Ninety-four of six
 * hundred and ninety-three coins were permanently unnamed, unpriced and
 * undated — and because the New feed sorted on that same null date, every coin
 * that graduated in the last several hours was invisible at the bottom of the
 * list.
 *
 * `symbol is null` first breaks the cycle. Newly graduated coins are decorated
 * on the very next pass regardless of how large the universe grows.
 */
export async function pgListStonks(limit = 200): Promise<StonkRow[]> {
  /*
   * Two queues, not one.
   *
   * The newest-first order below was fine while the universe fit inside one
   * pass. It no longer does: with StonkFun's direct CLMM launches included
   * there are thousands of listed coins against a pass that decorates a few
   * hundred, and newest-first meant a coin that had once been named would
   * never be re-priced again — its price frozen at whatever it was the day it
   * was found.
   *
   * So a quarter of the pass goes to the hot end (unnamed coins, then the
   * newest), where prices matter most and change fastest, and the rest goes to
   * whichever coins were priced longest ago. Every coin comes round within a
   * few passes, and the ones people are looking at never wait for the rotation.
   */
  const hot = Math.max(1, Math.floor(limit / 4));
  return withClient(async (client) => {
    const {rows} = await client.query(
      `select * from (
         (select s.* from public.stonks s
           where s.status = 'listed' and s.eligible is distinct from false
           order by (s.symbol is null) desc, s.graduated_at desc nulls last, s.mint desc
           limit $1)
         union
         (select s.* from public.stonks s
           left join public.stonk_stats st on st.mint = s.mint
           where s.status = 'listed' and s.eligible is distinct from false
           order by st.priced_at asc nulls first, s.mint
           limit $2)
       ) picked`,
      [hot, limit - hot],
    );
    return rows as StonkRow[];
  });
}

/**
 * The top of the Trending or New feed, for the worker's tape keeper.
 *
 * The same view, filters and order as `listStonks`, which reads through
 * PostgREST — a client the worker does not have, since it holds only the
 * database URL. Kept to the two sorts the keeper needs; the feed itself still
 * reads `listStonks`.
 */
export async function pgFeedHead(
  sort: "trending" | "new",
  limit: number,
  newMinMcapUsd: number,
): Promise<StonkRow[]> {
  const order =
    sort === "new"
      ? "graduated_at desc nulls last, mint desc"
      : "trending_score desc nulls last, vol_24h desc nulls last, mint desc";
  return withClient(async (client) => {
    const recencyCutoff =
      sort === "new" ? new Date(Date.now() - NEW_FEED_RECENCY_MS).toISOString() : null;
    const {rows} = await client.query(
      `select * from public.stonk_feed
        where status = 'listed'
          and launchpad is not null
          and (eligible is null or eligible is true)
          ${
            sort === "new"
              ? "and last_mcap > 0 and (last_mcap >= $2 or graduated_at >= $3)"
              : sort === "trending"
                ? "and last_mcap >= $2"
                : ""
          }
        order by ${order}
        limit $1`,
      sort === "new"
        ? [limit, newMinMcapUsd, recencyCutoff]
        : sort === "trending"
          ? [limit, TRENDING_MIN_MCAP_USD]
          : [limit],
    );
    return rows as StonkRow[];
  });
}

/** In-app coin page view — bumps engagement used in trending score. */
export async function pgIncrementPageView(mint: string): Promise<void> {
  return withClient(async (client) => {
    await client.query(
      `insert into public.stonk_stats (mint, page_views, updated_at)
       values ($1, 1, now())
       on conflict (mint) do update set
         page_views = coalesce(public.stonk_stats.page_views, 0) + 1,
         updated_at = now()`,
      [mint],
    );
  });
}

/**
 * Launches still on the curve — progress first, trending activity at each step.
 *
 * Separate from `pgListStonks` rather than a flag on it, because the two
 * surfaces order by different things and mean different things. A graduated
 * coin is ranked by what it is worth; a graduating one by curve progress and
 * the trade activity the decorate pass writes on pending rows.
 */
/**
 * How many listed stonks sit in each quote ticker, for filter chips.
 *
 * Same `stonk_feed` filters as `listStonks` / `pgFeedHead` — listed,
 * launchpad set, three-state eligible, and the New floor when that sort is
 * active. Counts every row, not one page.
 */
export async function pgStonkQuoteCounts(
  sort: "trending" | "new" | "marketCap",
  newMinMcapUsd: number,
): Promise<{byTicker: Record<string, number>; total: number}> {
  return withClient(async (client) => {
    const recencyCutoff =
      sort === "new" ? new Date(Date.now() - NEW_FEED_RECENCY_MS).toISOString() : null;
    const floorClause =
      sort === "new"
        ? "and last_mcap > 0 and (last_mcap >= $1 or graduated_at >= $2)"
        : sort === "trending"
          ? "and last_mcap >= $1"
          : "";
    const params =
      sort === "new"
        ? [newMinMcapUsd, recencyCutoff]
        : sort === "trending"
          ? [TRENDING_MIN_MCAP_USD]
          : [];

    const {rows} = await client.query<{quote_ticker: string; n: number}>(
      `select quote_ticker, count(*)::int as n
         from public.stonk_feed
        where status = 'listed'
          and launchpad is not null
          and (eligible is null or eligible is true)
          and quote_ticker is not null
          and quote_ticker <> ''
          ${floorClause}
        group by quote_ticker`,
      params,
    );

    const byTicker: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byTicker[row.quote_ticker] = row.n;
      total += row.n;
    }
    return {byTicker, total};
  });
}

/** Drop stale graduating progress after the reconciler marks a pool TRADE. */
export async function pgClearCurveProgress(mints: readonly string[]): Promise<void> {
  if (mints.length === 0) return;
  await withClient((client) =>
    client.query(
      `update public.stonks set curve_progress = null
        where mint = any($1::text[])`,
      [mints],
    ),
  );
}

export async function pgListGraduating(limit = 200): Promise<StonkRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query(
      `select * from public.stonk_feed
       where status = 'pending'
         and launchpad is not null
         and eligible is distinct from false
       order by curve_progress desc nulls last,
                trending_score desc nulls last,
                vol_24h desc nulls last,
                mint desc
       limit $1`,
      [limit],
    );
    return rows as StonkRow[];
  });
}

export async function pgUniverseCount(): Promise<{listed: number; priced: number}> {
  return withClient(async (client) => {
    const {rows} = await client.query(
      `select
         count(*) filter (where s.status = 'listed') ::int as listed,
         count(*) filter (where st.last_price is not null) ::int as priced
       from public.stonks s
       left join public.stonk_stats st on st.mint = s.mint`,
    );
    return rows[0] as {listed: number; priced: number};
  });
}
