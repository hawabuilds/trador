import {json} from "@/lib/server/http";
import {requireCaller} from "@/lib/server/auth";
import {profileByHandle, setPortfolioPublic, upsertMe} from "@/lib/server/social";

export const dynamic = "force-dynamic";

/**
 * Create or update the caller's own profile.
 *
 * The id comes from the verified token and the body supplies only the fields a
 * person is allowed to change about themselves. There is deliberately no way to
 * address another user here — that would be one missing check away from letting
 * anyone rewrite anyone's profile.
 */
export async function PUT(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as {
    handle?: string;
    displayName?: string | null;
    pfpUrl?: string | null;
    bio?: string | null;
    wallet?: string | null;
    /** Show the Stonkfolio on the public profile. Absent leaves it unchanged. */
    portfolioPublic?: boolean;
    /** Whose shared link this person arrived through. Used only for a new account. */
    referredBy?: string | null;
  };

  try {
    await upsertMe(caller.userId, {
      handle: body.handle ?? null,
      // Trimmed to the same limits the edit sheet enforces, because the sheet
      // is not the only thing that can call this.
      displayName: clip(body.displayName, 40),
      pfpUrl: body.pfpUrl ?? null,
      bio: clip(body.bio, 160),
      wallet: body.wallet ?? null,
      referredBy: typeof body.referredBy === "string" ? body.referredBy.slice(0, 40) : null,
    });
    if (typeof body.portfolioPublic === "boolean") {
      await setPortfolioPublic(caller.userId, body.portfolioPublic);
    }

    const profile = body.handle
      ? await profileByHandle(body.handle, caller.userId)
      : null;

    return json({ok: true, profile});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}
