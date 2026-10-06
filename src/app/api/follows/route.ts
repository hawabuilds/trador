import {asPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {followingOf, profileById, profileByHandle, setFollow} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** How much of a newly followed wallet's history to read on the spot. */
const BACKFILL_MS = 7 * 24 * 60 * 60_000;
const BACKFILL_SIGNATURES = 400;

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

    /*
     * Their last week, read now rather than from the next trade they make.
     * Following someone and finding an empty feed is the moment the feature
     * fails, and a week of signatures is a second or two — bounded, so one
     * very busy wallet cannot hold up the tap.
     */
    if (wantFollow) {
      const followed = await profileByHandle(body.handle, null).catch(() => null);
      const wallet = followed?.wallet ? asPubkey(followed.wallet) : null;
      if (wallet) {
        try {
          const {syncWalletTrades} = await import("@/lib/server/live/walletTrades");
          await syncWalletTrades(wallet, {sinceMs: BACKFILL_MS, max: BACKFILL_SIGNATURES});
        } catch {
          // Unreadable history is no reason to fail the follow; the webhook
          // picks up their next trade either way.
        }
      }
    }

    return json({following: await followingOf(caller.userId, caller.userId)});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
