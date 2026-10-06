import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {INBOX_LIMIT, inboxFor, inboxReady} from "@/lib/server/notifications/inbox";

export const dynamic = "force-dynamic";

/**
 * Everything that happened to the caller, newest first.
 *
 * Signed in only, and only ever about the caller: the user id comes from the
 * token, so there is no parameter anyone could point at somebody else's list.
 */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  if (!inboxReady) return json({items: []});

  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? INBOX_LIMIT);
    const items = await inboxFor(
      caller.userId,
      Number.isFinite(limit) ? Math.min(Math.max(1, limit), INBOX_LIMIT) : INBOX_LIMIT,
    );
    return json({items});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
