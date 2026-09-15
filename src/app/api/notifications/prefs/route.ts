import {requireCaller} from "@/lib/server/auth";
import {json} from "@/lib/server/http";
import {MILESTONES, type Milestone} from "@/lib/notifications/milestones";
import {prefsFor, savePrefs, type NotificationPrefs} from "@/lib/server/notifications/prefs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  return json({prefs: await prefsFor(caller.userId)});
}

/**
 * Update the caller's own preferences.
 *
 * Every field is validated rather than spread, because these land in a database
 * and then in a dispatch decision. A `minPositionUsd` of `"abc"` would become
 * `NaN`, and `NaN < anything` is false — so an unvalidated string here would
 * silently disable a person's holdings notifications with no error anywhere.
 */
export async function PUT(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<NotificationPrefs> = {};

  for (const key of [
    "muted",
    "socialFollow",
    "socialReply",
    "holdingsOn",
    "watchlistOn",
    "graduationOn",
  ] as const) {
    if (typeof body[key] === "boolean") patch[key] = body[key];
  }

  for (const key of ["holdingsMultiples", "watchlistMultiples"] as const) {
    const value = body[key];
    if (!Array.isArray(value)) continue;
    const allowed = new Set<number>(MILESTONES);
    const kept = value.map(Number).filter((step) => allowed.has(step)) as Milestone[];
    // An empty selection is "none of them", which is `holdingsOn: false`
    // expressed badly — ignored rather than stored as a list nothing matches.
    if (kept.length > 0) patch[key] = kept;
  }

  const min = Number(body.minPositionUsd);
  if (Number.isFinite(min) && min >= 0 && min <= 1_000_000) patch.minPositionUsd = min;

  for (const key of ["quietStart", "quietEnd"] as const) {
    const value = body[key];
    if (value === null) patch[key] = null;
    // Stored only if it parses as a clock time; `isQuiet` would otherwise treat
    // a malformed value as no window and quietly never go quiet.
    else if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())) {
      patch[key] = value.trim();
    }
  }

  if (typeof body.timezone === "string" && body.timezone.length <= 64) {
    patch.timezone = body.timezone;
  }

  try {
    return json({prefs: await savePrefs(caller.userId, patch)});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
