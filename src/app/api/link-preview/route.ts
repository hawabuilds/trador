import {linksIn} from "@/lib/linkPreview";
import {commentTarget, commentsReady, mintFor} from "@/lib/server/comments";
import {badRequest, json} from "@/lib/server/http";
import {resolveCards} from "@/lib/server/live/linkCards";

export const dynamic = "force-dynamic";

/**
 * Cards for the links in one stored comment.
 *
 * The caller names a comment, never a URL. The body is read from the store and
 * the links come out of it here, so this route can only ever fetch something a
 * person actually posted — see `commentTarget`.
 *
 * Open to signed-out readers, like the comments themselves. Resolution is
 * cached per URL in the process, so a busy thread costs one fetch per link.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("comment");
  if (!id) return badRequest("Which comment?");
  if (!commentsReady) return json({cards: []});

  try {
    const target = await commentTarget(id);
    if (!target) return json({cards: []});

    const links = linksIn(target.body);
    if (links.length === 0) return json({cards: []});

    const cards = await resolveCards(links, mintFor(target.kind, target.assetId));
    return json({cards});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
