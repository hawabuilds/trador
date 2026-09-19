import {requireCaller} from "@/lib/server/auth";
import {commentsReady, setLike} from "@/lib/server/comments";
import {badRequest, json} from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Like or unlike a comment, decided by `liked` in the body.
 *
 * Only an explicit `false` unlikes, so a malformed body can never quietly
 * remove a like the person meant to keep. Returns the fresh count so the client
 * can settle its optimistic number on the real one.
 */
export async function POST(request: Request, {params}: {params: {id: string}}) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!commentsReady) return json({error: "Comments are not stored here."}, {status: 503});

  const body = (await request.json().catch(() => ({}))) as {liked?: unknown};
  const liked = body.liked !== false;

  try {
    const result = await setLike(caller.userId, params.id, liked);
    if (!result) return badRequest("That comment is gone.");
    return json(result);
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
