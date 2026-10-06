import {optionalCaller} from "@/lib/server/auth";
import {commentsReady} from "@/lib/server/comments";
import {badRequest, json} from "@/lib/server/http";
import {FEED_PAGE, followingFeed, latestFeed} from "@/lib/server/socialFeed";

export const dynamic = "force-dynamic";

/** The lists the Feed tab can ask for. `following` and `top` land with their screens. */
const TABS = ["following", "latest"] as const;
type Tab = (typeof TABS)[number];

/**
 * One page of the Feed.
 *
 * Readable signed out, like the rest of the social reads: the vote state is
 * null rather than false for a visitor, which is what keeps a filled arrow off
 * the screen of someone with no account.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") ?? "latest") as Tab;
  if (!TABS.includes(tab)) return badRequest("Unknown feed.");

  if (!commentsReady) return json({items: [], cursor: null});

  const limit = Number(url.searchParams.get("limit") ?? FEED_PAGE);
  const caller = await optionalCaller(request);

  try {
    if (tab === "following") {
      // Signed out there is nobody to follow, and saying so beats an empty
      // list that looks like a bug.
      if (!caller) return json({items: [], cursor: null, signedOut: true});
      const page = await followingFeed({
        callerId: caller.userId,
        limit: Number.isFinite(limit) ? limit : FEED_PAGE,
        cursor: url.searchParams.get("cursor"),
      });
      return json(page);
    }

    const page = await latestFeed({
      limit: Number.isFinite(limit) ? limit : FEED_PAGE,
      cursor: url.searchParams.get("cursor"),
      callerId: caller?.userId ?? null,
    });
    return json(page);
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
