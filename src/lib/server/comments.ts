/**
 * Comments on a coin or a stock — stored, shared, and tied to what their author
 * actually did in the asset.
 *
 * Until this existed the comments tab talked to a route that was never written.
 * Every fetch 404'd, the hook fell back to local storage, and every comment
 * anyone ever posted lived only in their own browser. Nobody could see anyone
 * else's; the tab looked empty to everyone but the author.
 *
 * Two drivers, same store. The worker and local scripts use direct Postgres.
 * Vercel uses PostgREST (`hasDatabase`) — `DATABASE_URL` on a serverless
 * function opens a pool per invocation, and a stale `db.*` host 503s the tab.
 *
 * Two rules:
 *
 *   1. **The author is the verified caller.** A post names no user; the id
 *      comes from the token, so nobody can comment as somebody else.
 *   2. **A position is derived, never claimed.** What sits beside a comment —
 *      bought, holding or sold, and the return — is read from the author's own
 *      wallet trades. There is no field a person can type it into.
 */

import {heldCommentPosition, resolveHeldUiAmount, uiAmountForMint, uiAmountHolds} from "@/lib/commentHold";
import {commentPosition} from "@/lib/commentPosition";
import {bandFor, boughtEarly} from "@/lib/holdingBand";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {stockForTicker} from "@/lib/stocks/registry";
import type {AssetComment, AssetKind, CommentPositionView} from "@/lib/types";
import {useDirectPg, withClient} from "./adminPg";
import {db, hasDatabase} from "./db";
import {HOLDINGS_STALE_FALLBACK_MS, readCachedBalances} from "./live/walletHoldingsCache";

export const commentsReady = useDirectPg || hasDatabase;

/** The newest this many, per asset. A page of history, not an archive. */
const LIMIT = 300;
const MAX_BODY = 500;

/** The mint an asset's positions are counted in, or null if it is not one. */
export function mintFor(kind: AssetKind, assetId: string): Pubkey | null {
  if (kind === "stonk") return asPubkey(assetId);
  return stockForTicker(assetId)?.mint ?? null;
}

interface TradeRow {
  wallet: string;
  side: "buy" | "sell";
  amount: string;
  value_usd: string | null;
  /** Unit price at the fill, which is what `Early` is judged on. */
  price_usd: string | null;
  at: string;
}

interface Row {
  id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: Date | string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  wallet: string | null;
  likes: string | number;
  liked: boolean;
}

function asId(value: unknown): string {
  return String(value);
}

export interface CommentPage {
  comments: AssetComment[];
  /** Pass back to read older threads. Null at the end of the list. */
  cursor: string | null;
}

/** Root comments per page. Replies ride along with their root. */
export const COMMENT_PAGE = 20;

const encodeCursor = (createdAt: string, id: string) => `${createdAt}|${id}`;

function decodeCursor(cursor: string | null | undefined): {at: string; id: string} | null {
  if (!cursor) return null;
  const cut = cursor.lastIndexOf("|");
  if (cut < 1) return null;
  const at = cursor.slice(0, cut);
  const id = cursor.slice(cut + 1);
  return Number.isNaN(Date.parse(at)) || !/^\d+$/.test(id) ? null : {at, id};
}

/**
 * A page of threads: newest roots first, each with every reply it has.
 *
 * Paged over roots rather than over comments, because a page that cut a thread
 * in half would show replies with nothing to answer. Keyset, not offset — a
 * busy coin gets comments between one page and the next.
 */
export async function listComments(
  kind: AssetKind,
  assetId: string,
  callerId: string | null,
  options: {limit?: number; cursor?: string | null} = {},
): Promise<CommentPage> {
  const limit = Math.min(Math.max(options.limit ?? COMMENT_PAGE, 1), 50);
  const cursor = decodeCursor(options.cursor);

  const {roots, replies} = useDirectPg
    ? await listRowsPg(kind, assetId, callerId, limit, cursor)
    : await listRowsRest(kind, assetId, callerId, limit, cursor);

  const rows = [...roots, ...replies];

  const [positions, standings] = await Promise.all([
    positionsFor(
      mintFor(kind, assetId),
      [...new Set(rows.map((row) => row.wallet).filter((wallet): wallet is string => !!wallet))],
    ),
    // One read of the season's table for the whole page, not one per comment.
    import("./ranks")
      .then(({standingsFor}) => standingsFor([...new Set(rows.map((row) => row.user_id))]))
      .catch(() => new Map()),
  ]);

  const comments = rows.map((row) => ({
    id: row.id,
    assetId,
    parentId: row.parent_id,
    author: {
      handle: row.handle ?? "someone",
      displayName: row.display_name ?? row.handle ?? "Someone",
      pfpUrl: row.pfp_url,
      rank: standings.get(row.user_id)?.rank.id ?? "intern",
    },
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    // `count(*)` is bigint, which the driver returns as a string.
    likes: Number(row.likes),
    liked: callerId ? Boolean(row.liked) : null,
    position: row.wallet ? (positions.get(row.wallet) ?? null) : null,
  }));

  const last = roots[roots.length - 1];
  return {
    comments,
    cursor:
      roots.length === limit && last
        ? encodeCursor(new Date(last.created_at).toISOString(), last.id)
        : null,
  };
}

async function listRowsPg(
  kind: AssetKind,
  assetId: string,
  callerId: string | null,
  limit: number,
  cursor: {at: string; id: string} | null,
): Promise<{roots: Row[]; replies: Row[]}> {
  return withClient(async (client) => {
    /*
     * The caller's placeholder differs between the two reads below, because
     * Postgres refuses a query carrying a parameter it never references — the
     * replies read has no kind or asset to filter by, so its numbering starts
     * again.
     */
    const columns = (caller: string) => `c.id::text, c.user_id, c.parent_id::text, c.body, c.created_at,
              u.handle, u.display_name, u.pfp_url, u.wallet,
              (select count(*) from public.comment_likes l where l.comment_id = c.id) as likes,
              exists (
                select 1 from public.comment_likes l
                 where l.comment_id = c.id and l.user_id = ${caller}
              ) as liked`;

    const {rows: roots} = await client.query<Row>(
      `select ${columns("$3")}
         from public.comments c
         join public.users u on u.id = c.user_id
        where c.kind = $1 and c.asset_id = $2 and c.parent_id is null
          and ($4::timestamptz is null or (c.created_at, c.id) < ($4::timestamptz, $5::bigint))
        order by c.created_at desc, c.id desc
        limit $6`,
      [kind, assetId, callerId ?? "", cursor?.at ?? null, cursor?.id ?? "0", limit],
    );
    if (roots.length === 0) return {roots, replies: []};

    const {rows: replies} = await client.query<Row>(
      `select ${columns("$1")}
         from public.comments c
         join public.users u on u.id = c.user_id
        where c.parent_id = any($2::bigint[])
        order by c.created_at asc`,
      [callerId ?? "", roots.map((row) => row.id)],
    );
    return {roots, replies};
  });
}

/**
 * The same page over PostgREST, which has neither row-value comparison nor
 * correlated subqueries: the keyset is spelled out and the counts are extra
 * reads over the ids this page returned. The service role bypasses RLS, so
 * these are the same rows the SQL path returns.
 */
async function listRowsRest(
  kind: AssetKind,
  assetId: string,
  callerId: string | null,
  limit: number,
  cursor: {at: string; id: string} | null,
): Promise<{roots: Row[]; replies: Row[]}> {
  let request = db()
    .from("comments")
    .select("id, parent_id, body, created_at, user_id")
    .eq("kind", kind)
    .eq("asset_id", assetId)
    .is("parent_id", null)
    .order("created_at", {ascending: false})
    .order("id", {ascending: false})
    .limit(limit);

  if (cursor) {
    request = request.or(
      `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`,
    );
  }

  const {data: rootRows, error} = await request;
  if (error) throw new Error(error.message);
  const roots = rootRows ?? [];
  if (roots.length === 0) return {roots: [], replies: []};

  const {data: replyRows, error: replyError} = await db()
    .from("comments")
    .select("id, parent_id, body, created_at, user_id")
    .in("parent_id", roots.map((row) => row.id))
    .order("created_at", {ascending: true});
  if (replyError) throw new Error(replyError.message);
  const replies = replyRows ?? [];

  const found = [...roots, ...replies];
  const userIds = [...new Set(found.map((row) => row.user_id as string))];
  const commentIds = found.map((row) => row.id);

  const [usersResult, likesResult] = await Promise.all([
    db().from("users").select("id, handle, display_name, pfp_url, wallet").in("id", userIds),
    db().from("comment_likes").select("comment_id, user_id").in("comment_id", commentIds),
  ]);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (likesResult.error) throw new Error(likesResult.error.message);

  const byUser = new Map(
    (usersResult.data ?? []).map((user) => [
      user.id as string,
      user as {
        handle: string | null;
        display_name: string | null;
        pfp_url: string | null;
        wallet: string | null;
      },
    ]),
  );

  const likeCount = new Map<string, number>();
  const likedByCaller = new Set<string>();
  for (const like of likesResult.data ?? []) {
    const id = asId(like.comment_id);
    likeCount.set(id, (likeCount.get(id) ?? 0) + 1);
    if (callerId && like.user_id === callerId) likedByCaller.add(id);
  }

  const toRow = (row: Record<string, unknown>): Row => {
    const id = asId(row.id);
    const user = byUser.get(row.user_id as string);
    return {
      id,
      user_id: row.user_id as string,
      parent_id: row.parent_id == null ? null : asId(row.parent_id),
      body: row.body as string,
      created_at: row.created_at as string,
      handle: user?.handle ?? null,
      display_name: user?.display_name ?? null,
      pfp_url: user?.pfp_url ?? null,
      wallet: user?.wallet ?? null,
      likes: likeCount.get(id) ?? 0,
      liked: likedByCaller.has(id),
    };
  };

  return {roots: roots.map(toRow), replies: replies.map(toRow)};
}

async function positionsFor(
  mint: Pubkey | null,
  wallets: readonly string[],
): Promise<Map<string, CommentPositionView>> {
  const found = new Map<string, CommentPositionView>();
  if (!mint || wallets.length === 0) return found;

  try {
    const trades = useDirectPg ? await tradesPg(wallets, mint) : await tradesRest(wallets, mint);
    if (trades.length === 0) return found;

    let priceUsd: number | null = null;
    try {
      const {jupTokens} = await import("./live/jupTokens");
      priceUsd = (await jupTokens([mint])).get(mint)?.usdPrice ?? null;
    } catch {
      // No current price: holders get a status without a return, which
      // `commentPosition` handles.
    }

    const earliest = await earliestPriceFor(mint);

    const byWallet = new Map<string, typeof trades>();
    for (const trade of trades) {
      byWallet.set(trade.wallet, [...(byWallet.get(trade.wallet) ?? []), trade]);
    }

    for (const [wallet, own] of byWallet) {
      const position = commentPosition(
        own.map((trade) => ({
          side: trade.side,
          amount: Number(trade.amount),
          valueUsd: trade.value_usd === null ? null : Number(trade.value_usd),
        })),
        priceUsd,
      );
      if (position) {
        const firstBuy = own
          .filter((trade) => trade.side === "buy" && trade.price_usd !== null)
          .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))[0];
        found.set(wallet, {
          band: bandFor(position.heldUsd),
          status: position.status,
          early: boughtEarly({
            firstBuyPriceUsd: firstBuy ? Number(firstBuy.price_usd) : null,
            earliestPriceUsd: earliest,
          }),
        });
      }
    }
  } catch {
    // Trade history not set up, or unreachable. Comments still load.
  }

  // Someone who just bought — or whose history has not been parsed yet —
  // still holds, and a public comment should say so. Same cache-then-RPC
  // path `holdsAsset` uses; never invents a dollar figure.
  const missing = wallets.filter((wallet) => !found.has(wallet));
  if (missing.length > 0) {
    await fillHeldFromBalances(found, mint, missing);
  }

  return found;
}

async function fillHeldFromBalances(
  found: Map<string, CommentPositionView>,
  mint: Pubkey,
  wallets: readonly string[],
): Promise<void> {
  await Promise.all(
    wallets.map(async (wallet) => {
      const pubkey = asPubkey(wallet);
      if (!pubkey) return;
      try {
        if (await holdsAsset(pubkey, mint)) {
          found.set(wallet, heldCommentPosition());
        }
      } catch {
        // Unreadable balance: leave the comment without a badge, same as
        // a trade-history miss. Never block the thread.
      }
    }),
  );
}

/**
 * The earliest unit price anyone's wallet recorded for this coin.
 *
 * Not the launch price: it is the first fill *we* saw, so for a coin we met
 * late it is already high. `Early` is withheld rather than wrongly given as a
 * result, which is the right way round for a badge that claims conviction.
 */
export async function earliestPriceFor(mint: Pubkey): Promise<number | null> {
  try {
    if (useDirectPg) {
      const rows = await withClient(async (client) =>
        (
          await client.query<{price_usd: string}>(
            `select price_usd from public.wallet_trades
              where mint = $1 and price_usd is not null and price_usd > 0
              order by at asc limit 1`,
            [mint],
          )
        ).rows,
      );
      return rows[0] ? Number(rows[0].price_usd) : null;
    }
    const {data} = await db()
      .from("wallet_trades")
      .select("price_usd")
      .eq("mint", mint)
      .not("price_usd", "is", null)
      .gt("price_usd", 0)
      .order("at", {ascending: true})
      .limit(1);
    const first = (data ?? [])[0] as {price_usd: string} | undefined;
    return first ? Number(first.price_usd) : null;
  } catch {
    // No history to judge against: nobody gets the badge.
    return null;
  }
}

async function tradesPg(wallets: readonly string[], mint: Pubkey): Promise<TradeRow[]> {
  return withClient(async (client) => {
    const {rows} = await client.query<TradeRow>(
      `select wallet, side, amount, value_usd, price_usd, at
         from public.wallet_trades
        where wallet = any($1) and mint = $2`,
      [wallets, mint],
    );
    return rows;
  });
}

async function tradesRest(wallets: readonly string[], mint: Pubkey): Promise<TradeRow[]> {
  const {data, error} = await db()
    .from("wallet_trades")
    .select("wallet, side, amount, value_usd, price_usd, at")
    .in("wallet", [...wallets])
    .eq("mint", mint);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    wallet: row.wallet as string,
    side: row.side as "buy" | "sell",
    amount: String(row.amount),
    value_usd: row.value_usd === null ? null : String(row.value_usd),
    price_usd: row.price_usd === null ? null : String(row.price_usd),
    at: String(row.at),
  }));
}

/**
 * Does this wallet hold the asset right now?
 *
 * Same sources Stonkfolio already trusts: a fresh `wallet_holdings_cache`
 * row first, live RPC next, then a stale cache when the chain cannot be
 * read. The previous path used only `balancesFor` and treated every RPC
 * failure as "not holding", so a signed-in holder whose portfolio had just
 * loaded from cache was refused.
 *
 * Trade history is still not consulted. History only knows about trades it
 * has parsed, so someone who bought on another app, or whose history has
 * not been read yet, would be wrongly refused.
 *
 * A coin with no current price counts any positive balance, since there is no
 * way to tell dust from a position and refusing a real holder is the worse
 * mistake.
 */
export async function holdsAsset(wallet: Pubkey, mint: Pubkey): Promise<boolean> {
  const priceUsd = await priceForMint(mint);

  const fresh = await readCachedBalances(wallet);
  const freshCache = fresh ? uiAmountForMint(fresh.byMint, mint) : undefined;

  let rpc: {ok: true; uiAmount: number} | {ok: false} = {ok: false};
  if (freshCache === undefined) {
    try {
      const {balancesFor} = await import("./live/holdings");
      const balances = await balancesFor(wallet, [mint]);
      const held = balances.tokens[mint];
      if (!held || !/^\d+$/.test(held.amount)) {
        rpc = {ok: true, uiAmount: 0};
      } else {
        rpc = {ok: true, uiAmount: Number(held.amount) / 10 ** held.decimals};
      }
    } catch {
      rpc = {ok: false};
    }
  }

  const stale =
    freshCache === undefined && !rpc.ok
      ? await readCachedBalances(wallet, HOLDINGS_STALE_FALLBACK_MS)
      : null;
  const staleCache = stale ? uiAmountForMint(stale.byMint, mint) : undefined;

  const resolved = resolveHeldUiAmount({freshCache, rpc, staleCache});
  if ("failed" in resolved) {
    // Nothing to read. The caller treats this as a refusal so a post can
    // be retried once a balance is available — never as a silent allow.
    throw new Error("Could not read the wallet's balance.");
  }
  return uiAmountHolds(resolved.uiAmount, priceUsd);
}

async function priceForMint(mint: Pubkey): Promise<number | null> {
  try {
    const {jupTokens} = await import("./live/jupTokens");
    return (await jupTokens([mint])).get(mint)?.usdPrice ?? null;
  } catch {
    return null;
  }
}

export type PostResult =
  | {ok: true; id: string; parentAuthorId: string | null}
  | {ok: false; reason: string};

export async function postComment(input: {
  userId: string;
  kind: AssetKind;
  assetId: string;
  body: string;
  parentId: string | null;
}): Promise<PostResult> {
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!body) return {ok: false, reason: "Write something first."};
  if (!mintFor(input.kind, input.assetId)) return {ok: false, reason: "Unknown asset."};

  return useDirectPg ? postCommentPg(input, body) : postCommentRest(input, body);
}

async function postCommentPg(
  input: {
    userId: string;
    kind: AssetKind;
    assetId: string;
    parentId: string | null;
  },
  body: string,
): Promise<PostResult> {
  return withClient(async (client) => {
    let parentAuthorId: string | null = null;

    if (input.parentId) {
      /*
       * A reply must belong to the same asset as what it replies to. Without
       * this check a reply posted on one coin could attach itself to a thread
       * on any other.
       */
      const {rows} = await client.query<{user_id: string}>(
        `select user_id from public.comments
          where id = $1 and kind = $2 and asset_id = $3`,
        [input.parentId, input.kind, input.assetId],
      );
      if (rows.length === 0) return {ok: false, reason: "That comment is gone."};
      parentAuthorId = rows[0].user_id;
    }

    const {rows} = await client.query<{id: string}>(
      `insert into public.comments (user_id, kind, asset_id, parent_id, body)
       values ($1, $2, $3, $4, $5)
       returning id::text`,
      [input.userId, input.kind, input.assetId, input.parentId, body],
    );

    return {ok: true, id: rows[0].id, parentAuthorId};
  });
}

async function postCommentRest(
  input: {
    userId: string;
    kind: AssetKind;
    assetId: string;
    parentId: string | null;
  },
  body: string,
): Promise<PostResult> {
  let parentAuthorId: string | null = null;

  if (input.parentId) {
    const {data, error} = await db()
      .from("comments")
      .select("user_id")
      .eq("id", input.parentId)
      .eq("kind", input.kind)
      .eq("asset_id", input.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return {ok: false, reason: "That comment is gone."};
    parentAuthorId = data.user_id as string;
  }

  const {data, error} = await db()
    .from("comments")
    .insert({
      user_id: input.userId,
      kind: input.kind,
      asset_id: input.assetId,
      parent_id: input.parentId,
      body,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return {ok: true, id: asId(data.id), parentAuthorId};
}

/** Like or unlike. Idempotent both ways, so a double tap is harmless. */
export type LikeResult =
  | {ok: true; likes: number; liked: boolean}
  /** Voting on your own comment, which is refused outright. */
  | {ok: false; reason: "self"}
  | {ok: false; reason: "missing"};

/**
 * Vote on a comment, and move the author's rep if the vote earns any.
 *
 * Two different rules, deliberately:
 *
 *   - **Anyone signed in can vote.** A like is a reader saying a comment was
 *     useful, and a reader is allowed to think so without holding the coin.
 *     The count on the comment is the count.
 *   - **Only a holder's vote earns rep.** Rep is a claim about calls, so it is
 *     bought with a position. A non-holder's like still shows; it just does
 *     not move anybody up the ladder.
 *
 * Voting on your own comment is refused rather than ignored. Silently dropping
 * it would leave the button looking broken.
 */
export async function setLike(
  userId: string,
  commentId: string,
  liked: boolean,
): Promise<LikeResult> {
  if (!/^\d+$/.test(commentId)) return {ok: false, reason: "missing"};

  const subject = await voteSubject(commentId);
  if (!subject) return {ok: false, reason: "missing"};
  if (subject.authorId === userId) return {ok: false, reason: "self"};

  const counted = useDirectPg
    ? await setLikePg(userId, commentId, liked)
    : await setLikeRest(userId, commentId, liked);
  if (!counted) return {ok: false, reason: "missing"};

  /*
   * Rep after the vote is recorded, and never in its way.
   *
   * Awaited rather than detached, because a serverless function can freeze the
   * moment it returns and a floating write would be lost. `awardRep` swallows
   * its own failures, so this cannot turn a counted vote into a failed one.
   */
  const {awardRep, removeRep} = await import("./ranks");
  if (liked) {
    const {rankedUp} = await awardRep(userId, subject);
    if (rankedUp) {
      const {notifyRankUp} = await import("./notifications/events");
      await notifyRankUp(subject.authorId, rankedUp).catch(() => {});
    }
  } else {
    await removeRep(userId, commentId);
  }

  return {ok: true, ...counted};
}

/** Who wrote a comment, where it sits, and what it says. */
async function voteSubject(commentId: string) {
  const target = await commentTarget(commentId);
  if (!target || !target.userId) return null;

  const {walletOf} = await import("./social");
  const wallet = await walletOf(target.userId).catch(() => null);

  return {
    commentId,
    authorId: target.userId,
    authorWallet: wallet,
    mint: mintFor(target.kind, target.assetId),
    body: target.body,
  };
}

async function setLikePg(
  userId: string,
  commentId: string,
  liked: boolean,
): Promise<{likes: number; liked: boolean} | null> {
  return withClient(async (client) => {
    const exists = await client.query(`select 1 from public.comments where id = $1`, [commentId]);
    if (exists.rowCount === 0) return null;

    if (liked) {
      await client.query(
        `insert into public.comment_likes (comment_id, user_id)
         values ($1, $2) on conflict do nothing`,
        [commentId, userId],
      );
    } else {
      await client.query(
        `delete from public.comment_likes where comment_id = $1 and user_id = $2`,
        [commentId, userId],
      );
    }

    const {rows} = await client.query<{likes: string}>(
      `select count(*) as likes from public.comment_likes where comment_id = $1`,
      [commentId],
    );
    return {likes: Number(rows[0].likes), liked};
  });
}

async function setLikeRest(
  userId: string,
  commentId: string,
  liked: boolean,
): Promise<{likes: number; liked: boolean} | null> {
  const {data: exists, error: existsError} = await db()
    .from("comments")
    .select("id")
    .eq("id", commentId)
    .maybeSingle();
  if (existsError) throw new Error(existsError.message);
  if (!exists) return null;

  if (liked) {
    const {error} = await db()
      .from("comment_likes")
      .upsert({comment_id: commentId, user_id: userId}, {onConflict: "comment_id,user_id"});
    if (error) throw new Error(error.message);
  } else {
    const {error} = await db()
      .from("comment_likes")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  const {count, error} = await db()
    .from("comment_likes")
    .select("comment_id", {count: "exact", head: true})
    .eq("comment_id", commentId);
  if (error) throw new Error(error.message);
  return {likes: count ?? 0, liked};
}

export interface CommentTarget {
  kind: AssetKind;
  assetId: string;
  body: string;
  /** Who wrote it, which is who a vote on it earns rep for. */
  userId: string;
}

/**
 * One comment's body and the asset it sits under.
 *
 * Link previews resolve from this rather than from a URL in the request, so
 * the only addresses this server ever fetches are ones somebody already posted
 * and the store already holds. A route that took the URL from the caller would
 * be a fetcher anyone on the internet could point anywhere.
 */
export async function commentTarget(id: string): Promise<CommentTarget | null> {
  if (!/^\d+$/.test(id)) return null;

  if (useDirectPg) {
    return withClient(async (client) => {
      const {rows} = await client.query<{
        kind: string;
        asset_id: string;
        body: string;
        user_id: string;
      }>(
        `select kind, asset_id, body, user_id from public.comments where id = $1::bigint`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      const kind = row.kind === "stonk" || row.kind === "stock" ? row.kind : null;
      return kind
        ? {kind, assetId: row.asset_id, body: row.body, userId: row.user_id}
        : null;
    });
  }

  const {data, error} = await db()
    .from("comments")
    .select("kind, asset_id, body, user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as {kind: string; asset_id: string; body: string; user_id: string};
  const kind = row.kind === "stonk" || row.kind === "stock" ? row.kind : null;
  return kind ? {kind, assetId: row.asset_id, body: row.body, userId: row.user_id} : null;
}

/**
 * What this wallet first paid for a coin, per unit.
 *
 * The same number the Early badge is worked out from, shared so rep and the
 * badge cannot disagree about who was early.
 */
export async function firstBuyPriceFor(wallet: Pubkey, mint: Pubkey): Promise<number | null> {
  try {
    const trades = useDirectPg
      ? await tradesPg([wallet], mint)
      : await tradesRest([wallet], mint);

    const buys = trades
      .filter((trade) => trade.side === "buy" && Number(trade.price_usd) > 0)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));

    return buys[0] ? Number(buys[0].price_usd) : null;
  } catch {
    return null;
  }
}
