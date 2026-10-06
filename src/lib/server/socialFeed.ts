/**
 * The Feed tab's reads.
 *
 * Three lists share one shape so the screen renders one item type: Latest is
 * every comment newest first, Following adds the trades of people you follow,
 * and Top calls ranks by Useful votes. Only Latest is implemented here; the
 * other two land with their own screens.
 *
 * Paging is keyset, never an offset. The feed is written to constantly, and an
 * offset page re-reads rows that have shifted under it — which shows up as a
 * comment appearing twice as someone scrolls.
 */

import {asPubkey, type Pubkey} from "@/lib/pubkey";
import type {AssetKind, CommentAuthor} from "@/lib/types";
import {useDirectPg, withClient} from "./adminPg";
import {db} from "./db";
import {snapshotStock} from "./snapshot";
import {rowToStonk, stonksByMints} from "./live/universeStore";

/** What a feed row says about the coin it is about. */
export interface FeedAsset {
  kind: AssetKind;
  id: string;
  symbol: string;
  imageUrl: string | null;
}

export interface FeedComment {
  type: "comment";
  id: string;
  asset: FeedAsset;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  /** Useful votes. The same rows the heart used to count. */
  likes: number;
  /** Whether the caller voted. Null when nobody is signed in. */
  liked: boolean | null;
  replies: number;
}

/**
 * A buy or a sell by someone you follow.
 *
 * Deliberately without amounts. The feed says what somebody did and roughly
 * where — "bought at $40M market cap", "sold in profit" — because that is what
 * a call is. How much they put in is their business, and lives behind Public
 * portfolio on their own profile.
 */
export interface FeedTrade {
  type: "trade";
  id: string;
  asset: FeedAsset;
  actor: CommentAuthor;
  side: "buy" | "sell";
  createdAt: string;
  /** Market cap when they bought. Null when the coin's supply was never read. */
  marketCapUsd: number | null;
  /** How a sell went, when their own history says so. Null when it cannot. */
  outcome: "profit" | "loss" | null;
}

export type FeedItem = FeedComment | FeedTrade;

export interface FeedPage {
  items: FeedItem[];
  /** Pass back as `cursor` for the next page. Null when the list is exhausted. */
  cursor: string | null;
}

/** Rows per page. The screen asks for more as the list runs out. */
export const FEED_PAGE = 20;

interface Row {
  id: string;
  kind: string;
  asset_id: string;
  body: string;
  created_at: string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  likes: number | string;
  liked: boolean;
  replies: number | string;
}

const encodeCursor = (createdAt: string, id: string) => `${createdAt}|${id}`;

function decodeCursor(cursor: string | null): {at: string; id: string} | null {
  if (!cursor) return null;
  const cut = cursor.lastIndexOf("|");
  if (cut < 1) return null;
  const at = cursor.slice(0, cut);
  const id = cursor.slice(cut + 1);
  return Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id) ? null : {at, id};
}

/**
 * The coin each comment is about, in one read per side of the universe.
 *
 * A page of twenty comments is rarely twenty different coins, and resolving
 * them one at a time is what turns a feed into twenty round trips.
 */
export async function assetsFor(
  rows: readonly {kind: string; asset_id: string}[],
): Promise<Map<string, FeedAsset>> {
  const found = new Map<string, FeedAsset>();

  const mints = [
    ...new Set(
      rows
        .filter((row) => row.kind === "stonk")
        .map((row) => asPubkey(row.asset_id))
        .filter((mint): mint is Pubkey => mint !== null),
    ),
  ];

  if (mints.length > 0) {
    const stonks = await stonksByMints(mints);
    for (const [mint, entry] of stonks) {
      const stonk = rowToStonk(entry.row, entry.stat);
      found.set(`stonk:${mint}`, {
        kind: "stonk",
        id: mint,
        symbol: stonk.symbol,
        imageUrl: stonk.imageUrl,
      });
    }
  }

  for (const row of rows) {
    if (row.kind !== "stock") continue;
    const key = `stock:${row.asset_id}`;
    if (found.has(key)) continue;
    const stock = snapshotStock(row.asset_id);
    if (stock) {
      // Stocks have no artwork anywhere in the app: a ticker and a tick is
      // how a listed equity is shown, so the row renders the same way here.
      found.set(key, {kind: "stock", id: stock.ticker, symbol: stock.ticker, imageUrl: null});
    }
  }

  return found;
}

async function latestRowsPg(
  limit: number,
  cursor: {at: string; id: string} | null,
  callerId: string | null,
): Promise<Row[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<Row>(
      `select c.id::text, c.kind, c.asset_id, c.body, c.created_at,
              u.handle, u.display_name, u.pfp_url,
              (select count(*) from public.comment_likes l where l.comment_id = c.id) as likes,
              exists (
                select 1 from public.comment_likes l
                 where l.comment_id = c.id and l.user_id = $1
              ) as liked,
              (select count(*) from public.comments r where r.parent_id = c.id) as replies
         from public.comments c
         join public.users u on u.id = c.user_id
        where c.parent_id is null
          and ($2::timestamptz is null or (c.created_at, c.id) < ($2::timestamptz, $3::bigint))
        order by c.created_at desc, c.id desc
        limit $4`,
      [callerId ?? "", cursor?.at ?? null, cursor?.id ?? "0", limit],
    );
    return rows;
  });
}

/**
 * The same page over PostgREST, which has no row-value comparison and no
 * correlated subqueries: the keyset is spelled out and the counts are two
 * extra reads over the ids this page returned.
 */
async function latestRowsRest(
  limit: number,
  cursor: {at: string; id: string} | null,
  callerId: string | null,
): Promise<Row[]> {
  let request = db()
    .from("comments")
    .select("id, kind, asset_id, body, created_at, user_id")
    .is("parent_id", null)
    .order("created_at", {ascending: false})
    .order("id", {ascending: false})
    .limit(limit);

  if (cursor) {
    request = request.or(
      `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`,
    );
  }

  const {data, error} = await request;
  if (error) throw new Error(error.message);
  const found = data ?? [];
  if (found.length === 0) return [];

  const ids = found.map((row) => row.id);
  const [users, likes, replies] = await Promise.all([
    db()
      .from("users")
      .select("id, handle, display_name, pfp_url")
      .in("id", [...new Set(found.map((row) => row.user_id as string))]),
    db().from("comment_likes").select("comment_id, user_id").in("comment_id", ids),
    db().from("comments").select("parent_id").in("parent_id", ids),
  ]);
  if (users.error) throw new Error(users.error.message);
  if (likes.error) throw new Error(likes.error.message);
  if (replies.error) throw new Error(replies.error.message);

  const byUser = new Map(
    (users.data ?? []).map((user) => [user.id as string, user as Record<string, string | null>]),
  );
  const likeCount = new Map<string, number>();
  const likedByCaller = new Set<string>();
  for (const like of likes.data ?? []) {
    const id = String(like.comment_id);
    likeCount.set(id, (likeCount.get(id) ?? 0) + 1);
    if (callerId && like.user_id === callerId) likedByCaller.add(id);
  }
  const replyCount = new Map<string, number>();
  for (const reply of replies.data ?? []) {
    const id = String(reply.parent_id);
    replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
  }

  return found.map((row) => {
    const id = String(row.id);
    const user = byUser.get(row.user_id as string);
    return {
      id,
      kind: row.kind as string,
      asset_id: row.asset_id as string,
      body: row.body as string,
      created_at: row.created_at as string,
      handle: (user?.handle as string | null) ?? null,
      display_name: (user?.display_name as string | null) ?? null,
      pfp_url: (user?.pfp_url as string | null) ?? null,
      likes: likeCount.get(id) ?? 0,
      liked: likedByCaller.has(id),
      replies: replyCount.get(id) ?? 0,
    };
  });
}

/**
 * Every comment, newest first.
 *
 * Replies are left out: a reply read apart from what it answers is noise, and
 * the thread it belongs to is one tap away on the coin's page.
 */
export async function latestFeed(options: {
  limit?: number;
  cursor?: string | null;
  callerId: string | null;
}): Promise<FeedPage> {
  const limit = Math.min(Math.max(options.limit ?? FEED_PAGE, 1), 50);
  const cursor = decodeCursor(options.cursor ?? null);

  const rows = useDirectPg
    ? await latestRowsPg(limit, cursor, options.callerId)
    : await latestRowsRest(limit, cursor, options.callerId);

  const assets = await assetsFor(rows);

  const items: FeedComment[] = [];
  for (const row of rows) {
    // A comment whose coin has since been delisted has nothing to point at.
    const asset = assets.get(`${row.kind}:${row.asset_id}`);
    if (!asset) continue;
    items.push({
      type: "comment",
      id: row.id,
      asset,
      author: {
        handle: row.handle ?? "someone",
        displayName: row.display_name ?? row.handle ?? "Someone",
        pfpUrl: row.pfp_url,
      },
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      likes: Number(row.likes),
      liked: options.callerId ? Boolean(row.liked) : null,
      replies: Number(row.replies),
    });
  }

  // The cursor comes from the last row read, not the last item kept, so a page
  // thinned by a delisted coin still advances.
  const last = rows[rows.length - 1];
  return {
    items,
    cursor:
      rows.length === limit && last
        ? encodeCursor(new Date(last.created_at).toISOString(), last.id)
        : null,
  };
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

interface TradeRow {
  wallet: string;
  signature: string;
  mint: string;
  side: "buy" | "sell";
  amount: string | number;
  value_usd: string | number | null;
  price_usd: string | number | null;
  at: string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
}

/**
 * Who the caller follows, and whose trades may be shown.
 *
 * The wallet comes back only when Public portfolio is on, so the same read
 * decides both "whose comments" and "whose trades" — one source of truth for a
 * promise made in Settings.
 */
async function followedBy(callerId: string): Promise<{ids: string[]; wallets: string[]}> {
  if (useDirectPg) {
    const rows = await withClient(async (client) =>
      (
        await client.query<{id: string; wallet: string | null; portfolio_public: boolean | null}>(
          `select u.id, u.wallet, u.portfolio_public
             from public.users u
             join public.follows f on f.followee_id = u.id
            where f.follower_id = $1`,
          [callerId],
        )
      ).rows,
    );
    return {
      ids: rows.map((row) => row.id),
      wallets: rows
        .filter((row) => row.wallet && row.portfolio_public !== false)
        .map((row) => String(row.wallet)),
    };
  }

  const {data: follows, error} = await db()
    .from("follows")
    .select("followee_id")
    .eq("follower_id", callerId)
    .limit(1_000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((follows ?? []).map((row) => String(row.followee_id)))];
  if (ids.length === 0) return {ids: [], wallets: []};

  const {data: users, error: usersError} = await db()
    .from("users")
    .select("id, wallet, portfolio_public")
    .in("id", ids);
  if (usersError) throw new Error(usersError.message);

  return {
    ids,
    wallets: (users ?? [])
      .filter((user) => user.wallet && user.portfolio_public !== false)
      .map((user) => String(user.wallet)),
  };
}

async function followedTradeRows(
  wallets: string[],
  limit: number,
  cursor: {at: string; id: string} | null,
): Promise<TradeRow[]> {
  if (wallets.length === 0) return [];

  if (useDirectPg) {
    return withClient(async (client) =>
      (
        await client.query<TradeRow>(
          `select t.wallet, t.signature, t.mint, t.side, t.amount, t.value_usd, t.price_usd, t.at,
                  u.handle, u.display_name, u.pfp_url
             from public.wallet_trades t
             join public.users u on u.wallet = t.wallet
            where t.wallet = any($1)
              and ($2::timestamptz is null or t.at < $2::timestamptz)
            order by t.at desc
            limit $3`,
          [wallets, cursor?.at ?? null, limit],
        )
      ).rows,
    );
  }

  let request = db()
    .from("wallet_trades")
    .select("wallet, signature, mint, side, amount, value_usd, price_usd, at")
    .in("wallet", wallets)
    .order("at", {ascending: false})
    .limit(limit);
  if (cursor) request = request.lt("at", cursor.at);

  const {data, error} = await request;
  if (error) throw new Error(error.message);
  const trades = data ?? [];
  if (trades.length === 0) return [];

  const {data: users} = await db()
    .from("users")
    .select("wallet, handle, display_name, pfp_url")
    .in("wallet", [...new Set(trades.map((row) => String(row.wallet)))]);
  const byWallet = new Map(
    (users ?? []).map((user) => [String(user.wallet), user as Record<string, string | null>]),
  );

  return trades.map((row) => {
    const user = byWallet.get(String(row.wallet));
    return {
      ...(row as unknown as TradeRow),
      handle: (user?.handle as string | null) ?? null,
      display_name: (user?.display_name as string | null) ?? null,
      pfp_url: (user?.pfp_url as string | null) ?? null,
    };
  });
}

async function followedCommentRows(
  authorIds: string[],
  limit: number,
  cursor: {at: string; id: string} | null,
  callerId: string,
): Promise<Row[]> {
  if (authorIds.length === 0) return [];

  if (useDirectPg) {
    return withClient(async (client) =>
      (
        await client.query<Row>(
          `select c.id::text, c.kind, c.asset_id, c.body, c.created_at,
                  u.handle, u.display_name, u.pfp_url,
                  (select count(*) from public.comment_likes l where l.comment_id = c.id) as likes,
                  exists (
                    select 1 from public.comment_likes l
                     where l.comment_id = c.id and l.user_id = $1
                  ) as liked,
                  (select count(*) from public.comments r where r.parent_id = c.id) as replies
             from public.comments c
             join public.users u on u.id = c.user_id
            where c.parent_id is null
              and c.user_id = any($2)
              and ($3::timestamptz is null or c.created_at < $3::timestamptz)
            order by c.created_at desc
            limit $4`,
          [callerId, authorIds, cursor?.at ?? null, limit],
        )
      ).rows,
    );
  }

  let request = db()
    .from("comments")
    .select("id, kind, asset_id, body, created_at, user_id")
    .is("parent_id", null)
    .in("user_id", authorIds)
    .order("created_at", {ascending: false})
    .limit(limit);
  if (cursor) request = request.lt("created_at", cursor.at);

  const {data, error} = await request;
  if (error) throw new Error(error.message);
  const found = data ?? [];
  if (found.length === 0) return [];

  const [users, likes, replies] = await Promise.all([
    db()
      .from("users")
      .select("id, handle, display_name, pfp_url")
      .in("id", [...new Set(found.map((row) => String(row.user_id)))]),
    db().from("comment_likes").select("comment_id, user_id").in("comment_id", found.map((row) => row.id)),
    db().from("comments").select("parent_id").in("parent_id", found.map((row) => row.id)),
  ]);

  const byUser = new Map(
    (users.data ?? []).map((user) => [String(user.id), user as Record<string, string | null>]),
  );
  const likeCount = new Map<string, number>();
  for (const like of likes.data ?? []) {
    const id = String(like.comment_id);
    likeCount.set(id, (likeCount.get(id) ?? 0) + 1);
  }
  const replyCount = new Map<string, number>();
  for (const reply of replies.data ?? []) {
    const id = String(reply.parent_id);
    replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
  }

  return found.map((row) => {
    const id = String(row.id);
    const user = byUser.get(String(row.user_id));
    return {
      id,
      kind: row.kind as string,
      asset_id: row.asset_id as string,
      body: row.body as string,
      created_at: row.created_at as string,
      handle: (user?.handle as string | null) ?? null,
      display_name: (user?.display_name as string | null) ?? null,
      pfp_url: (user?.pfp_url as string | null) ?? null,
      likes: likeCount.get(id) ?? 0,
      liked: (likes.data ?? []).some(
        (like) => String(like.comment_id) === id && like.user_id === callerId,
      ),
      replies: replyCount.get(id) ?? 0,
    };
  });
}

/**
 * Market cap at the moment of a buy.
 *
 * Price at the fill times the supply measured on chain. Old trades are valued
 * against today's supply, which is the best we can say for a figure nobody
 * recorded at the time; a coin whose supply was never read says nothing at all
 * rather than guessing.
 */
async function marketCapsAt(rows: TradeRow[]): Promise<Map<string, number>> {
  const caps = new Map<string, number>();
  const mints = [...new Set(rows.filter((row) => row.side === "buy").map((row) => row.mint))]
    .map((mint) => asPubkey(mint))
    .filter((mint): mint is Pubkey => mint !== null);
  if (mints.length === 0) return caps;

  const stonks = await stonksByMints(mints);
  for (const row of rows) {
    // Buys only. A sell's market cap is not what the row says, and a figure
    // nobody renders should not be in the payload at all.
    if (row.side !== "buy") continue;
    const supply = stonks.get(row.mint)?.row.circulating_supply;
    const price = row.price_usd === null ? null : Number(row.price_usd);
    if (supply && price && price > 0) caps.set(`${row.wallet}:${row.signature}:${row.mint}`, price * Number(supply));
  }
  return caps;
}

/**
 * How a sell went, from the seller's own history.
 *
 * Average cost across their buys against what they sold at. Null when either
 * side is unpriced — "in profit" is a claim about someone's money, and a
 * guessed one would be worse than saying nothing.
 */
async function sellOutcomes(rows: TradeRow[]): Promise<Map<string, "profit" | "loss">> {
  const outcomes = new Map<string, "profit" | "loss">();
  const sells = rows.filter((row) => row.side === "sell");
  if (sells.length === 0) return outcomes;

  const wallets = [...new Set(sells.map((row) => row.wallet))];
  const mints = [...new Set(sells.map((row) => row.mint))];

  const history = useDirectPg
    ? await withClient(async (client) =>
        (
          await client.query<{wallet: string; mint: string; side: string; amount: string; value_usd: string | null}>(
            `select wallet, mint, side, amount, value_usd
               from public.wallet_trades
              where wallet = any($1) and mint = any($2) and side = 'buy'`,
            [wallets, mints],
          )
        ).rows,
      )
    : (
        await db()
          .from("wallet_trades")
          .select("wallet, mint, side, amount, value_usd")
          .in("wallet", wallets)
          .in("mint", mints)
          .eq("side", "buy")
      ).data ?? [];

  const cost = new Map<string, {units: number; usd: number}>();
  for (const row of history as {wallet: string; mint: string; amount: string | number; value_usd: string | number | null}[]) {
    if (row.value_usd === null) continue;
    const key = `${row.wallet}:${row.mint}`;
    const held = cost.get(key) ?? {units: 0, usd: 0};
    held.units += Number(row.amount);
    held.usd += Number(row.value_usd);
    cost.set(key, held);
  }

  for (const sell of sells) {
    const bought = cost.get(`${sell.wallet}:${sell.mint}`);
    const soldPrice = sell.price_usd === null ? null : Number(sell.price_usd);
    if (!bought || bought.units <= 0 || !soldPrice || soldPrice <= 0) continue;
    const average = bought.usd / bought.units;
    if (!(average > 0)) continue;
    outcomes.set(
      `${sell.wallet}:${sell.signature}:${sell.mint}`,
      soldPrice >= average ? "profit" : "loss",
    );
  }

  return outcomes;
}

/**
 * The Following feed: what the people you follow did and said, newest first.
 *
 * Two streams merged by time rather than one query, because they live in
 * different tables and a join would page badly. Each is read a page deep, the
 * pair is merged, and the cursor is the oldest item kept — so the next page
 * picks up from exactly there whichever stream it came from.
 */
export async function followingFeed(options: {
  callerId: string;
  limit?: number;
  cursor?: string | null;
}): Promise<FeedPage> {
  const limit = Math.min(Math.max(options.limit ?? FEED_PAGE, 1), 50);
  const cursor = decodeCursor(options.cursor ?? null);

  const {ids, wallets} = await followedBy(options.callerId);
  if (ids.length === 0) return {items: [], cursor: null};

  const [commentRows, tradeRows] = await Promise.all([
    followedCommentRows(ids, limit, cursor, options.callerId),
    followedTradeRows(wallets, limit, cursor),
  ]);

  const assets = await assetsFor([
    ...commentRows,
    ...tradeRows.map((row) => ({...row, kind: "stonk", asset_id: row.mint}) as unknown as Row),
  ]);
  const [caps, outcomes] = await Promise.all([marketCapsAt(tradeRows), sellOutcomes(tradeRows)]);

  const comments: FeedItem[] = commentRows.flatMap((row) => {
    const asset = assets.get(`${row.kind}:${row.asset_id}`);
    if (!asset) return [];
    return [
      {
        type: "comment" as const,
        id: row.id,
        asset,
        author: {
          handle: row.handle ?? "someone",
          displayName: row.display_name ?? row.handle ?? "Someone",
          pfpUrl: row.pfp_url,
        },
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
        likes: Number(row.likes),
        liked: Boolean(row.liked),
        replies: Number(row.replies),
      },
    ];
  });

  const trades: FeedItem[] = tradeRows.flatMap((row) => {
    const asset = assets.get(`stonk:${row.mint}`);
    if (!asset) return [];
    const key = `${row.wallet}:${row.signature}:${row.mint}`;
    return [
      {
        type: "trade" as const,
        id: key,
        asset,
        actor: {
          handle: row.handle ?? "someone",
          displayName: row.display_name ?? row.handle ?? "Someone",
          pfpUrl: row.pfp_url,
        },
        side: row.side,
        createdAt: new Date(row.at).toISOString(),
        marketCapUsd: caps.get(key) ?? null,
        outcome: outcomes.get(key) ?? null,
      },
    ];
  });

  const merged = [...comments, ...trades]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);

  const last = merged[merged.length - 1];
  // Both streams were read a page deep, so there is more to read unless both
  // came back short.
  const exhausted = commentRows.length < limit && tradeRows.length < limit;
  return {
    items: merged,
    cursor: exhausted || !last ? null : encodeCursor(last.createdAt, last.id),
  };
}

// ---------------------------------------------------------------------------
// Top calls
// ---------------------------------------------------------------------------

export type TopWindow = "week" | "all";

/** How far back "This week" reaches. */
const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * How many comments the PostgREST path ranks in memory.
 *
 * It cannot order by a count it has to compute, so it reads the window's
 * comments and ranks them here. The SQL path, which production uses, ranks in
 * the database and pages properly.
 */
const REST_RANK_POOL = 500;

const encodeRankCursor = (likes: number, id: string) => `${likes}|${id}`;

function decodeRankCursor(cursor: string | null | undefined): {likes: number; id: string} | null {
  if (!cursor) return null;
  const cut = cursor.lastIndexOf("|");
  if (cut < 1) return null;
  const likes = Number(cursor.slice(0, cut));
  const id = cursor.slice(cut + 1);
  return Number.isFinite(likes) && /^\d+$/.test(id) ? {likes, id} : null;
}

async function topRowsPg(
  since: string | null,
  limit: number,
  cursor: {likes: number; id: string} | null,
  callerId: string | null,
): Promise<Row[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<Row>(
      `select * from (
         select c.id::text, c.kind, c.asset_id, c.body, c.created_at,
                u.handle, u.display_name, u.pfp_url,
                (select count(*) from public.comment_likes l where l.comment_id = c.id)::int as likes,
                exists (
                  select 1 from public.comment_likes l
                   where l.comment_id = c.id and l.user_id = $1
                ) as liked,
                (select count(*) from public.comments r where r.parent_id = c.id)::int as replies
           from public.comments c
           join public.users u on u.id = c.user_id
          where c.parent_id is null
            and ($2::timestamptz is null or c.created_at >= $2::timestamptz)
       ) ranked
        where ($3::int is null or (ranked.likes, ranked.id::bigint) < ($3::int, $4::bigint))
        order by ranked.likes desc, ranked.id::bigint desc
        limit $5`,
      [callerId ?? "", since, cursor?.likes ?? null, cursor?.id ?? "0", limit],
    );
    return rows;
  });
}

async function topRowsRest(
  since: string | null,
  limit: number,
  cursor: {likes: number; id: string} | null,
  callerId: string | null,
): Promise<Row[]> {
  let request = db()
    .from("comments")
    .select("id, kind, asset_id, body, created_at, user_id")
    .is("parent_id", null)
    .order("created_at", {ascending: false})
    .limit(REST_RANK_POOL);
  if (since) request = request.gte("created_at", since);

  const {data, error} = await request;
  if (error) throw new Error(error.message);
  const found = data ?? [];
  if (found.length === 0) return [];

  const ids = found.map((row) => row.id);
  const [users, likes, replies] = await Promise.all([
    db()
      .from("users")
      .select("id, handle, display_name, pfp_url")
      .in("id", [...new Set(found.map((row) => String(row.user_id)))]),
    db().from("comment_likes").select("comment_id, user_id").in("comment_id", ids),
    db().from("comments").select("parent_id").in("parent_id", ids),
  ]);

  const byUser = new Map(
    (users.data ?? []).map((user) => [String(user.id), user as Record<string, string | null>]),
  );
  const likeCount = new Map<string, number>();
  const likedByCaller = new Set<string>();
  for (const like of likes.data ?? []) {
    const id = String(like.comment_id);
    likeCount.set(id, (likeCount.get(id) ?? 0) + 1);
    if (callerId && like.user_id === callerId) likedByCaller.add(id);
  }
  const replyCount = new Map<string, number>();
  for (const reply of replies.data ?? []) {
    const id = String(reply.parent_id);
    replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
  }

  return rankByVotes(
    found.map((row) => {
      const id = String(row.id);
      const user = byUser.get(String(row.user_id));
      return {
        id,
        kind: row.kind as string,
        asset_id: row.asset_id as string,
        body: row.body as string,
        created_at: row.created_at as string,
        handle: (user?.handle as string | null) ?? null,
        display_name: (user?.display_name as string | null) ?? null,
        pfp_url: (user?.pfp_url as string | null) ?? null,
        likes: likeCount.get(id) ?? 0,
        liked: likedByCaller.has(id),
        replies: replyCount.get(id) ?? 0,
      };
    }),
    {cursor, limit},
  );
}

/**
 * Order by votes, newest first on a tie, and drop whatever a cursor has
 * already shown.
 *
 * Pure, and the same ordering the SQL path asks the database for
 * (`order by likes desc, id desc` with the keyset in the where clause). Kept
 * out of the query so the rule itself can be tested without a database.
 */
export function rankByVotes<T extends {id: string; likes: number | string}>(
  rows: readonly T[],
  options: {cursor?: {likes: number; id: string} | null; limit: number},
): T[] {
  const cursor = options.cursor ?? null;
  return [...rows]
    .sort(
      (left, right) =>
        Number(right.likes) - Number(left.likes) || Number(right.id) - Number(left.id),
    )
    .filter(
      (row) =>
        !cursor ||
        Number(row.likes) < cursor.likes ||
        (Number(row.likes) === cursor.likes && Number(row.id) < Number(cursor.id)),
    )
    .slice(0, options.limit);
}

/**
 * The best calls, by Useful votes.
 *
 * Votes alone, not votes mixed with age or reach: whatever the ranking phase
 * adds later, what this says today is exactly what the number beside each
 * comment says, and anyone can count it.
 *
 * Ties break on the newer comment, so a fresh call does not sit behind an old
 * one forever on an equal score.
 */
export async function topCalls(options: {
  window?: TopWindow;
  limit?: number;
  cursor?: string | null;
  callerId: string | null;
}): Promise<FeedPage> {
  const limit = Math.min(Math.max(options.limit ?? FEED_PAGE, 1), 50);
  const cursor = decodeRankCursor(options.cursor ?? null);
  const since =
    (options.window ?? "week") === "week"
      ? new Date(Date.now() - WEEK_MS).toISOString()
      : null;

  const rows = useDirectPg
    ? await topRowsPg(since, limit, cursor, options.callerId)
    : await topRowsRest(since, limit, cursor, options.callerId);

  const assets = await assetsFor(rows);

  const items: FeedComment[] = rows.flatMap((row) => {
    const asset = assets.get(`${row.kind}:${row.asset_id}`);
    if (!asset) return [];
    return [
      {
        type: "comment" as const,
        id: row.id,
        asset,
        author: {
          handle: row.handle ?? "someone",
          displayName: row.display_name ?? row.handle ?? "Someone",
          pfpUrl: row.pfp_url,
        },
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
        likes: Number(row.likes),
        liked: options.callerId ? Boolean(row.liked) : null,
        replies: Number(row.replies),
      },
    ];
  });

  const last = rows[rows.length - 1];
  return {
    items,
    cursor:
      rows.length === limit && last ? encodeRankCursor(Number(last.likes), last.id) : null,
  };
}
