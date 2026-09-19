/**
 * Comments on a coin or a stock — stored, shared, and tied to what their author
 * actually did in the asset.
 *
 * Until this existed the comments tab talked to a route that was never written.
 * Every fetch 404'd, the hook fell back to local storage, and every comment
 * anyone ever posted lived only in their own browser. Nobody could see anyone
 * else's; the tab looked empty to everyone but the author.
 *
 * Two rules:
 *
 *   1. **The author is the verified caller.** A post names no user; the id
 *      comes from the token, so nobody can comment as somebody else.
 *   2. **A position is derived, never claimed.** What sits beside a comment —
 *      bought, holding or sold, and the return — is read from the author's own
 *      wallet trades. There is no field a person can type it into.
 */

import {commentPosition} from "@/lib/commentPosition";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {stockForTicker} from "@/lib/stocks/registry";
import type {AssetComment, AssetKind, CommentPositionView} from "@/lib/types";
import {hasAdminPg, withClient} from "./adminPg";

export const commentsReady = hasAdminPg;

/** The newest this many, per asset. A page of history, not an archive. */
const LIMIT = 300;
const MAX_BODY = 500;

/** The mint an asset's positions are counted in, or null if it is not one. */
export function mintFor(kind: AssetKind, assetId: string): Pubkey | null {
  if (kind === "stonk") return asPubkey(assetId);
  return stockForTicker(assetId)?.mint ?? null;
}

interface Row {
  id: string;
  parent_id: string | null;
  body: string;
  created_at: Date;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  wallet: string | null;
  likes: string | number;
  liked: boolean;
}

export async function listComments(
  kind: AssetKind,
  assetId: string,
  callerId: string | null,
): Promise<AssetComment[]> {
  const rows = await withClient(async (client) => {
    const {rows} = await client.query<Row>(
      `select c.id::text, c.parent_id::text, c.body, c.created_at,
              u.handle, u.display_name, u.pfp_url, u.wallet,
              (select count(*) from public.comment_likes l where l.comment_id = c.id) as likes,
              exists (
                select 1 from public.comment_likes l
                 where l.comment_id = c.id and l.user_id = $3
              ) as liked
         from public.comments c
         join public.users u on u.id = c.user_id
        where c.kind = $1 and c.asset_id = $2
        order by c.created_at desc
        limit ${LIMIT}`,
      // `$3` is referenced above, so it always has a type — an unreferenced
      // parameter fails the whole query in Postgres, which is what once made
      // user search return nobody.
      [kind, assetId, callerId ?? ""],
    );
    return rows;
  });

  const positions = await positionsFor(
    mintFor(kind, assetId),
    [...new Set(rows.map((row) => row.wallet).filter((wallet): wallet is string => !!wallet))],
  );

  return rows
    .map((row) => ({
      id: row.id,
      assetId,
      parentId: row.parent_id,
      author: {
        handle: row.handle ?? "someone",
        displayName: row.display_name ?? row.handle ?? "Someone",
        pfpUrl: row.pfp_url,
      },
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      // `count(*)` is bigint, which the driver returns as a string.
      likes: Number(row.likes),
      liked: callerId ? Boolean(row.liked) : null,
      position: row.wallet ? (positions.get(row.wallet) ?? null) : null,
    }))
    .reverse();
}

/**
 * Each commenting wallet's position in this one mint.
 *
 * One query for every author's trades and one price lookup, however many
 * comments there are. A wallet whose history has never been read simply has no
 * trades yet, and shows no position rather than a wrong one. Any failure here
 * costs the positions, never the comments.
 */
async function positionsFor(
  mint: Pubkey | null,
  wallets: readonly string[],
): Promise<Map<string, CommentPositionView>> {
  const found = new Map<string, CommentPositionView>();
  if (!mint || wallets.length === 0) return found;

  try {
    const trades = await withClient(async (client) => {
      const {rows} = await client.query<{
        wallet: string;
        side: "buy" | "sell";
        amount: string;
        value_usd: string | null;
      }>(
        `select wallet, side, amount, value_usd
           from public.wallet_trades
          where wallet = any($1) and mint = $2`,
        [wallets, mint],
      );
      return rows;
    });
    if (trades.length === 0) return found;

    let priceUsd: number | null = null;
    try {
      const {jupTokens} = await import("./live/jupTokens");
      priceUsd = (await jupTokens([mint])).get(mint)?.usdPrice ?? null;
    } catch {
      // No current price: holders get a status without a return, which
      // `commentPosition` handles.
    }

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
        found.set(wallet, {
          boughtUsd: position.boughtUsd,
          status: position.status,
          gainPct: position.gainPct,
        });
      }
    }
  } catch {
    // Trade history not set up, or unreachable. Comments still load.
  }

  return found;
}

/**
 * Worth less than this and a balance is dust, not a position.
 *
 * Selling "all" through a router routinely leaves a few base units behind, and
 * those crumbs must not keep the right to comment on a coin someone has left.
 *
 * A cent, not a dollar. Crumbs are fractions of a cent, while real positions
 * start small: a first stock buy of $0.61 is a genuine position, and a dollar
 * floor would have refused the person who made it.
 */
const MIN_POSITION_USD = 0.01;

/**
 * Does this wallet hold the asset right now?
 *
 * Read from the chain, not from trade history. History only knows about trades
 * it has parsed, so someone who bought on another app, or whose history has
 * not been read yet, would be wrongly refused — and someone who sold since the
 * last read would be wrongly allowed. The live balance has neither problem.
 *
 * A coin with no current price counts any positive balance, since there is no
 * way to tell dust from a position and refusing a real holder is the worse
 * mistake.
 */
export async function holdsAsset(wallet: Pubkey, mint: Pubkey): Promise<boolean> {
  const {balancesFor} = await import("./live/holdings");
  const balances = await balancesFor(wallet, [mint]);
  const held = balances.tokens[mint];
  if (!held || !/^\d+$/.test(held.amount) || BigInt(held.amount) === 0n) return false;

  const units = Number(held.amount) / 10 ** held.decimals;

  let priceUsd: number | null = null;
  try {
    const {jupTokens} = await import("./live/jupTokens");
    priceUsd = (await jupTokens([mint])).get(mint)?.usdPrice ?? null;
  } catch {
    priceUsd = null;
  }

  return priceUsd === null ? units > 0 : units * priceUsd >= MIN_POSITION_USD;
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

/** Like or unlike. Idempotent both ways, so a double tap is harmless. */
export async function setLike(
  userId: string,
  commentId: string,
  liked: boolean,
): Promise<{likes: number; liked: boolean} | null> {
  if (!/^\d+$/.test(commentId)) return null;

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
