import {json, notFound} from "@/lib/server/http";
import {optionalCaller} from "@/lib/server/auth";
import {followersOf, followingOf, profileByHandle} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/**
 * One profile, with its followers and following.
 *
 * Readable signed out — a profile link shared into a group chat has to open for
 * whoever taps it. `optionalCaller` is what makes `isFollowing` null rather
 * than false for a visitor: "not following" and "nobody is signed in" are
 * different states, and rendering the second as the first puts a Follow button
 * in front of someone with no account.
 */
export async function GET(
  request: Request,
  {params}: {params: {handle: string}},
) {
  const caller = await optionalCaller(request);
  const callerId = caller?.userId ?? null;

  try {
    const profile = await profileByHandle(params.handle, callerId);
    if (!profile) return notFound("No account with that handle.");

    const [followers, following, standing] = await Promise.all([
      followersOf(profile.id, callerId),
      followingOf(profile.id, callerId),
      // Their place this season, which the badge and the rep line read from.
      import("@/lib/server/ranks")
        .then(({standingFor}) => standingFor(profile.id))
        .catch(() => null),
    ]);

    return json({
      profile,
      followers,
      following,
      standing: standing
        ? {rep: standing.rep, rank: standing.rank.id, percentile: standing.percentile}
        : null,
    });
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
