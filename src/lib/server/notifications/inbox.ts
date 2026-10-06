/**
 * One list of the things that happened to you.
 *
 * Derived rather than stored. Every item here is already a row somewhere — a
 * reply is a comment, a vote is a like, a follower is a follow — and reading
 * them back costs four queries, where a notifications table would have to be
 * written to correctly from every path that can cause one. Nothing can drift
 * out of step with what actually happened, because there is only one copy.
 *
 * The exception is the price moves, which come from the push ledger and so
 * only exist for someone who had a device subscribed when the coin moved.
 * That is a real gap and it needs a row of its own to close; it is in the
 * schema proposal rather than worked around here, because the workaround is a
 * second source of truth.
 *
 * Both drivers, like everything else that reads the store: direct Postgres for
 * the worker and scripts, PostgREST on Vercel. PostgREST has no joins to lean
 * on, so it reads the ids first and stitches the rest in memory.
 */

import {assetPath, profilePath} from "@/lib/routes";
import type {AssetKind} from "@/lib/types";
import {useDirectPg, withClient} from "@/lib/server/adminPg";
import {db, hasDatabase} from "@/lib/server/db";
import {assetsFor, type FeedAsset} from "@/lib/server/socialFeed";
import {DEFAULT_PREFS, prefsFor} from "./prefs";

export const inboxReady = useDirectPg || hasDatabase;

/** The newest this many of each kind. A list, not an archive. */
export const INBOX_LIMIT = 40;

/** How far back a comment of mine can be and still collect votes here. */
const MINE_LIMIT = 200;

export type InboxKind =
  | "reply"
  | "votes"
  | "follow"
  | "holding_multiple"
  | "watchlist_multiple"
  | "graduation"
  | "graduating_soon";

export interface InboxActor {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  /** Whether you already follow them, which decides the Follow back button. */
  followsBack: boolean;
}

export interface InboxItem {
  /** Stable across reads, so the client can key rows and track what it saw. */
  id: string;
  kind: InboxKind;
  at: string;
  actor: InboxActor | null;
  /** The reply's words, or the comment that was voted on. */
  text: string | null;
  /** How many people, for votes. One for everything else. */
  count: number;
  /** The coin, for a price move. */
  asset: FeedAsset | null;
  /** The multiple a holding passed. */
  rung: number | null;
  /** Where tapping it goes. */
  href: string;
}

interface ReplyRow {
  id: string;
  body: string;
  created_at: Date | string;
  kind: string;
  asset_id: string;
  handle: string;
  display_name: string | null;
  pfp_url: string | null;
}

interface VoteRow {
  comment_id: string;
  kind: string;
  asset_id: string;
  body: string;
  votes: number;
  last_at: Date | string;
}

interface FollowRow {
  handle: string;
  display_name: string | null;
  pfp_url: string | null;
  created_at: Date | string;
  follows_back: boolean;
}

interface EventRow {
  kind: string;
  subject: string;
  rung: number;
  sent_at: Date | string;
}

const PRICE_KINDS = [
  "holding_multiple",
  "watchlist_multiple",
  "graduation",
  "graduating_soon",
] as const;

/** Postgres hands back a Date, PostgREST a string. The list only wants one. */
function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function asAssetKind(value: string): AssetKind | null {
  return value === "stonk" || value === "stock" ? value : null;
}

/* --------------------------------------------------------------- reads --- */

async function repliesPg(userId: string, limit: number): Promise<ReplyRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<ReplyRow>(
      `select r.id::text, r.body, r.created_at, r.kind, r.asset_id,
              u.handle, u.display_name, u.pfp_url
         from public.comments r
         join public.comments p on p.id = r.parent_id
         join public.users u on u.id = r.user_id
        where p.user_id = $1 and r.user_id <> $1
        order by r.created_at desc
        limit $2`,
      [userId, limit],
    );
    return rows;
  });
}

async function votesPg(userId: string, limit: number): Promise<VoteRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<VoteRow>(
      `select c.id::text as comment_id, c.kind, c.asset_id, c.body,
              count(*)::int as votes, max(l.created_at) as last_at
         from public.comment_likes l
         join public.comments c on c.id = l.comment_id
        where c.user_id = $1 and l.user_id <> $1
        group by c.id, c.kind, c.asset_id, c.body
        order by max(l.created_at) desc
        limit $2`,
      [userId, limit],
    );
    return rows;
  });
}

async function followersPg(userId: string, limit: number): Promise<FollowRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<FollowRow>(
      `select u.handle, u.display_name, u.pfp_url, f.created_at,
              exists (
                select 1 from public.follows back
                 where back.follower_id = $1 and back.followee_id = f.follower_id
              ) as follows_back
         from public.follows f
         join public.users u on u.id = f.follower_id
        where f.followee_id = $1
        order by f.created_at desc
        limit $2`,
      [userId, limit],
    );
    return rows;
  });
}

async function eventsPg(userId: string, limit: number): Promise<EventRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<EventRow>(
      `select kind, subject, rung, sent_at
         from public.notification_events
        where user_id = $1 and kind = any($2::text[])
        order by sent_at desc
        limit $3`,
      [userId, [...PRICE_KINDS], limit],
    );
    return rows;
  });
}

/** My own comment ids, which are what replies and votes hang off. */
async function myCommentIdsRest(userId: string): Promise<string[]> {
  const {data, error} = await db()
    .from("comments")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", {ascending: false})
    .limit(MINE_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as {id: number | string}[]).map((row) => String(row.id));
}

/** Handles and names for a set of user ids, in one read. */
async function usersRest(ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, {handle: string; display_name: string | null; pfp_url: string | null}>();

  const {data, error} = await db()
    .from("users")
    .select("id, handle, display_name, pfp_url")
    .in("id", [...new Set(ids)]);
  if (error) throw new Error(error.message);

  return new Map(
    ((data ?? []) as {id: string; handle: string; display_name: string | null; pfp_url: string | null}[]).map(
      (row) => [row.id, row],
    ),
  );
}

async function repliesRest(userId: string, limit: number): Promise<ReplyRow[]> {
  const mine = await myCommentIdsRest(userId);
  if (mine.length === 0) return [];

  const {data, error} = await db()
    .from("comments")
    .select("id, body, created_at, kind, asset_id, user_id")
    .in("parent_id", mine)
    .neq("user_id", userId)
    .order("created_at", {ascending: false})
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: number | string;
    body: string;
    created_at: Date | string;
    kind: string;
    asset_id: string;
    user_id: string;
  }[];
  const authors = await usersRest(rows.map((row) => row.user_id));

  return rows.flatMap((row) => {
    const author = authors.get(row.user_id);
    if (!author) return [];
    return [{
      id: String(row.id),
      body: row.body,
      created_at: row.created_at,
      kind: row.kind,
      asset_id: row.asset_id,
      handle: author.handle,
      display_name: author.display_name,
      pfp_url: author.pfp_url,
    }];
  });
}

async function votesRest(userId: string, limit: number): Promise<VoteRow[]> {
  const mine = await myCommentIdsRest(userId);
  if (mine.length === 0) return [];

  const {data, error} = await db()
    .from("comment_likes")
    .select("comment_id, user_id, created_at")
    .in("comment_id", mine)
    .neq("user_id", userId)
    .order("created_at", {ascending: false})
    .limit(limit * 10);
  if (error) throw new Error(error.message);

  const likes = (data ?? []) as {comment_id: number | string; created_at: string}[];
  if (likes.length === 0) return [];

  // Grouped here rather than in the query, which PostgREST cannot do.
  const grouped = new Map<string, {votes: number; last_at: string}>();
  for (const like of likes) {
    const key = String(like.comment_id);
    const seen = grouped.get(key);
    grouped.set(key, {
      votes: (seen?.votes ?? 0) + 1,
      last_at: !seen || like.created_at > seen.last_at ? like.created_at : seen.last_at,
    });
  }

  const ids = [...grouped.keys()];
  const {data: comments, error: commentsError} = await db()
    .from("comments")
    .select("id, kind, asset_id, body")
    .in("id", ids);
  if (commentsError) throw new Error(commentsError.message);

  const byId = new Map(
    ((comments ?? []) as {id: number | string; kind: string; asset_id: string; body: string}[]).map(
      (row) => [String(row.id), row],
    ),
  );

  return [...grouped]
    .flatMap(([id, counted]) => {
      const comment = byId.get(id);
      if (!comment) return [];
      return [{
        comment_id: id,
        kind: comment.kind,
        asset_id: comment.asset_id,
        body: comment.body,
        votes: counted.votes,
        last_at: counted.last_at,
      }];
    })
    .sort((a, b) => b.last_at.localeCompare(a.last_at))
    .slice(0, limit);
}

async function followersRest(userId: string, limit: number): Promise<FollowRow[]> {
  const {data, error} = await db()
    .from("follows")
    .select("follower_id, created_at")
    .eq("followee_id", userId)
    .order("created_at", {ascending: false})
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {follower_id: string; created_at: string}[];
  if (rows.length === 0) return [];

  const [authors, mine] = await Promise.all([
    usersRest(rows.map((row) => row.follower_id)),
    db()
      .from("follows")
      .select("followee_id")
      .eq("follower_id", userId)
      .in("followee_id", rows.map((row) => row.follower_id)),
  ]);

  const back = new Set(
    ((mine.data ?? []) as {followee_id: string}[]).map((row) => row.followee_id),
  );

  return rows.flatMap((row) => {
    const author = authors.get(row.follower_id);
    if (!author) return [];
    return [{
      handle: author.handle,
      display_name: author.display_name,
      pfp_url: author.pfp_url,
      created_at: row.created_at,
      follows_back: back.has(row.follower_id),
    }];
  });
}

async function eventsRest(userId: string, limit: number): Promise<EventRow[]> {
  const {data, error} = await db()
    .from("notification_events")
    .select("kind, subject, rung, sent_at")
    .eq("user_id", userId)
    .in("kind", [...PRICE_KINDS])
    .order("sent_at", {ascending: false})
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventRow[];
}

/**
 * Whether watchlist alerts are wanted, read the way this deployment reads.
 *
 * `prefsFor` goes straight to Postgres, which on a serverless function opens a
 * pool per invocation — the thing the whole driver split exists to avoid. This
 * list only needs the one switch, so on Vercel it asks PostgREST for the one
 * column instead of dragging a connection open to read a boolean.
 */
async function watchlistWanted(userId: string): Promise<boolean> {
  try {
    if (useDirectPg) return (await prefsFor(userId)).watchlistOn;

    const {data} = await db()
      .from("notification_prefs")
      .select("watchlist_on")
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as {watchlist_on?: boolean} | null;
    return row ? row.watchlist_on === true : DEFAULT_PREFS.watchlistOn;
  } catch {
    return DEFAULT_PREFS.watchlistOn;
  }
}

/* --------------------------------------------------------------- build --- */

function actorOf(row: {handle: string; display_name: string | null; pfp_url: string | null}, followsBack = false): InboxActor {
  return {
    handle: row.handle,
    displayName: row.display_name || row.handle,
    pfpUrl: row.pfp_url,
    followsBack,
  };
}

/**
 * Everything about you, newest first.
 *
 * A failure in one read costs that kind and nothing else: a list missing its
 * followers is far better than a screen that will not open.
 */
export async function inboxFor(userId: string, limit = INBOX_LIMIT): Promise<InboxItem[]> {
  if (!inboxReady) return [];

  const [watchlistOn, [replies, votes, followers, events]] = await Promise.all([
    watchlistWanted(userId),
    Promise.all([
      (useDirectPg ? repliesPg(userId, limit) : repliesRest(userId, limit)).catch(() => []),
      (useDirectPg ? votesPg(userId, limit) : votesRest(userId, limit)).catch(() => []),
      (useDirectPg ? followersPg(userId, limit) : followersRest(userId, limit)).catch(() => []),
      (useDirectPg ? eventsPg(userId, limit) : eventsRest(userId, limit)).catch(() => []),
    ]),
  ]);

  // The watchlist switch is the one that gates its own rows here too, so a
  // person who turned those off does not meet them again in the list.
  const wanted = events.filter(
    (row) => row.kind !== "watchlist_multiple" || watchlistOn,
  );

  const assets = await assetsFor(
    wanted.map((row) => ({kind: "stonk", asset_id: row.subject})),
  ).catch(() => new Map<string, FeedAsset>());

  const items: InboxItem[] = [];

  for (const row of replies) {
    const kind = asAssetKind(row.kind);
    items.push({
      id: `reply:${row.id}`,
      kind: "reply",
      at: asIso(row.created_at),
      actor: actorOf(row),
      text: row.body,
      count: 1,
      asset: null,
      rung: null,
      href: kind ? `${assetPath(kind, row.asset_id)}?comment=${row.id}` : profilePath(row.handle),
    });
  }

  for (const row of votes) {
    const kind = asAssetKind(row.kind);
    items.push({
      id: `votes:${row.comment_id}:${row.votes}`,
      kind: "votes",
      at: asIso(row.last_at),
      actor: null,
      text: row.body,
      count: Number(row.votes),
      asset: null,
      rung: null,
      href: kind ? `${assetPath(kind, row.asset_id)}?comment=${row.comment_id}` : "/feed",
    });
  }

  for (const row of followers) {
    items.push({
      id: `follow:${row.handle}`,
      kind: "follow",
      at: asIso(row.created_at),
      actor: actorOf(row, row.follows_back),
      text: null,
      count: 1,
      asset: null,
      rung: null,
      href: profilePath(row.handle),
    });
  }

  for (const row of wanted) {
    const asset = assets.get(`stonk:${row.subject}`) ?? null;
    items.push({
      id: `${row.kind}:${row.subject}:${row.rung}`,
      kind: row.kind as InboxKind,
      at: asIso(row.sent_at),
      actor: null,
      text: null,
      count: 1,
      asset,
      rung: row.rung || null,
      href: assetPath("stonk", row.subject),
    });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
