import {asPubkey} from "@/lib/pubkey";
import {optionalCaller, requireCaller} from "@/lib/server/auth";
import {commentsReady, holdsAsset, listComments, mintFor, postComment} from "@/lib/server/comments";
import {badRequest, json} from "@/lib/server/http";
import {profileById, walletOf} from "@/lib/server/social";
import type {AssetKind} from "@/lib/types";

export const dynamic = "force-dynamic";

function kindOf(value: string): AssetKind | null {
  return value === "stonk" || value === "stock" ? value : null;
}

/**
 * Comments for one asset, newest last, with their authors' positions.
 *
 * `localOnly` tells the client whether there is a store to post to. It is true
 * only when this deployment has no database, in which case the tab keeps its
 * old behaviour of saving to the browser — and says so.
 */
export async function GET(
  request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = kindOf(params.kind);
  const assetId = decodeURIComponent(params.id);
  if (!kind || !mintFor(kind, assetId)) return badRequest("Unknown asset.");

  if (!commentsReady) return json({comments: [], localOnly: true});

  try {
    const caller = await optionalCaller(request);
    const [comments, canPost] = await Promise.all([
      listComments(kind, assetId, caller?.userId ?? null),
      caller ? callerHolds(caller.userId, kind, assetId) : Promise.resolve(false),
    ]);
    // Said up front, so the composer can explain itself instead of accepting a
    // post that the server will then refuse.
    return json({comments, localOnly: false, canPost});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

export async function POST(
  request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const kind = kindOf(params.kind);
  const assetId = decodeURIComponent(params.id);
  if (!kind) return badRequest("Unknown asset.");
  if (!commentsReady) return json({error: "Comments are not stored on this deployment."}, {status: 503});

  const body = (await request.json().catch(() => ({}))) as {
    body?: unknown;
    parentId?: unknown;
  };
  if (typeof body.body !== "string") return badRequest("Write something first.");
  const parentId =
    typeof body.parentId === "string" && /^\d+$/.test(body.parentId) ? body.parentId : null;

  /*
   * Only holders speak.
   *
   * Checked here, on the server, against the live balance. A disabled text box
   * is a hint, not a rule — anyone can call this route directly — so this is
   * the only place the rule actually holds.
   */
  if (!(await callerHolds(caller.userId, kind, assetId))) {
    return json(
      {error: "Only holders can comment. Buy some to join the conversation."},
      {status: 403},
    );
  }

  try {
    const result = await postComment({
      userId: caller.userId,
      kind,
      assetId,
      body: body.body,
      parentId,
    });
    if (!result.ok) return badRequest(result.reason);

    const me = await profileById(caller.userId, caller.userId).catch(() => null);

    /*
     * Tell whoever was replied to — never yourself. Awaited, because a
     * serverless function can freeze the moment it returns and take a floating
     * send with it; `dispatch` swallows its own errors, so this cannot fail the
     * post.
     */
    if (result.parentAuthorId && result.parentAuthorId !== caller.userId) {
      const {notifyReplied} = await import("@/lib/server/notifications/events");
      await notifyReplied(
        result.parentAuthorId,
        me?.displayName ?? "Someone",
        kind,
        assetId,
        result.id,
      );
    }

    /*
     * Read the author's trades, so their position appears beside what they
     * just posted.
     *
     * A position comes from the wallet's own on-chain history, which is only
     * read on demand. Someone posting a take on a coin is exactly when theirs is
     * worth reading. Bounded, because the first read of a busy wallet can take a
     * while and the post has already succeeded: if it is slow, the position
     * shows on the next load instead.
     *
     * `walletOf` rather than `me.wallet`: a private Stonkfolio still has a
     * public comment, and that comment's holding badge reads the same wallet
     * `canPost` already used.
     */
    const wallet = asPubkey((await walletOf(caller.userId)) ?? me?.wallet ?? null);
    if (wallet) {
      await Promise.race([
        import("@/lib/server/live/walletTrades")
          .then(({syncWalletTrades}) => syncWalletTrades(wallet))
          .catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 6_000)),
      ]);
    }

    return json({ok: true, id: result.id});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

/** Whether this user's wallet currently holds the asset. False on any doubt. */
async function callerHolds(userId: string, kind: AssetKind, assetId: string): Promise<boolean> {
  const mint = mintFor(kind, assetId);
  if (!mint) return false;
  // `walletOf` reads the column directly over PostgREST on Vercel.
  // `profileById` needs DATABASE_URL and also hides a private portfolio.
  const wallet = asPubkey(await walletOf(userId));
  if (!wallet) return false;
  try {
    return await holdsAsset(wallet, mint);
  } catch {
    // An unreadable balance refuses rather than allows: the rule is the
    // point, and a post can be retried once the holding can be read.
    return false;
  }
}
