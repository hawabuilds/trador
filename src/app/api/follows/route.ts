import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {followingOf, setFollow} from "@/lib/server/social";

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
    const result = await setFollow(caller.userId, body.handle, body.following !== false);
    if (!result.ok) return badRequest("No account with that handle.");

    return json({following: await followingOf(caller.userId, caller.userId)});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
