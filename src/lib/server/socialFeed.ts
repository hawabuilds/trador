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

export interface FeedPage {
  items: FeedComment[];
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
async function assetsFor(rows: Row[]): Promise<Map<string, FeedAsset>> {
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

  return found
    .map((row) => {
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
    })
    .sort((left, right) =>
      Number(right.likes) - Number(left.likes) || Number(right.id) - Number(left.id),
    )
    .filter((row) =>
      !cursor ||
      Number(row.likes) < cursor.likes ||
      (Number(row.likes) === cursor.likes && Number(row.id) < Number(cursor.id)),
    )
    .slice(0, limit);
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
