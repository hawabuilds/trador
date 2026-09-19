import {asPubkey} from "@/lib/pubkey";
import {optionalCaller, requireCaller} from "@/lib/server/auth";
import {commentsReady, listComments, mintFor, postComment} from "@/lib/server/comments";
import {badRequest, json} from "@/lib/server/http";
import {profileById} from "@/lib/server/social";
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
    const comments = await listComments(kind, assetId, caller?.userId ?? null);
    return json({comments, localOnly: false});
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

  try {
    const result = await postComment({
      userId: caller.userId,
      kind,
      assetId,
      body: body.body,
      parentId,
    });
    if (!result.ok) return badRequest(result.reason);

    const me = await profileById(caller.userId, null).catch(() => null);

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
     */
    const wallet = asPubkey(me?.wallet ?? null);
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
