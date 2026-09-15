import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {followingOf, profileById, profileByHandle, setFollow} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Who the caller follows. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  try {
    return json({following: await followingOf(caller.userId, caller.userId)});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

/** Follow or unfollow, decided by `following` in the body. */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string;
    following?: boolean;
  };
  if (!body.handle) return badRequest("Which account?");

  try {
    // Absent means follow. Only an explicit `false` unfollows, so a malformed
    // body can never quietly remove a follow the person meant to keep.
    const wantFollow = body.following !== false;
    const result = await setFollow(caller.userId, body.handle, wantFollow);
    if (!result.ok) return badRequest("No account with that handle.");

    /*
     * Notify on the way past, and never fail the follow for it.
     *
     * Awaited rather than detached: a serverless function can freeze the
     * instant it returns, which kills a floating promise mid-send. `dispatch`
     * swallows its own errors, so awaiting costs a few milliseconds and cannot
     * turn a successful follow into a failed request.
     */
    if (wantFollow) {
      const me = await profileById(caller.userId, null).catch(() => null);
      const target = await profileByHandle(body.handle, null).catch(() => null);
      if (target) {
        const {notifyFollowed} = await import("@/lib/server/notifications/events");
        await notifyFollowed(
          target.id,
          me?.handle ?? "someone",
          me?.displayName ?? "Someone",
        );
      }
    }

    return json({following: await followingOf(caller.userId, caller.userId)});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
