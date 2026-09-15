/**
 * What each person wants to hear about.
 *
 * Reads return defaults rather than throwing when there is no row or no store,
 * because "has not opened settings yet" is the normal state and must not be a
 * reason to fail a dispatch pass.
 */

import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {
  DEFAULT_HOLDINGS_MULTIPLES,
  DEFAULT_WATCHLIST_MULTIPLES,
  MILESTONES,
  type Milestone,
} from "@/lib/notifications/milestones";

export interface NotificationPrefs {
  muted: boolean;
  socialFollow: boolean;
  socialReply: boolean;
  holdingsOn: boolean;
  holdingsMultiples: Milestone[];
  watchlistOn: boolean;
  watchlistMultiples: Milestone[];
  graduationOn: boolean;
  minPositionUsd: number;
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string;
}

/**
 * Defaults chosen so the first notification someone gets is one they wanted.
 *
 * Holdings on, watchlist off. A watchlist is a browsing tool — people star
 * twenty coins to look at later — while holdings are money. Defaulting
 * watchlist alerts on is the fastest way to teach someone to mute everything.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  muted: false,
  socialFollow: true,
  socialReply: true,
  holdingsOn: true,
  holdingsMultiples: [...DEFAULT_HOLDINGS_MULTIPLES],
  watchlistOn: false,
  watchlistMultiples: [...DEFAULT_WATCHLIST_MULTIPLES],
  graduationOn: true,
  minPositionUsd: 10,
  quietStart: null,
  quietEnd: null,
  timezone: "UTC",
};

const ALLOWED = new Set<number>(MILESTONES);

/** Only real rungs survive. A stored 7 would silently never match anything. */
function asMilestones(value: unknown, fallback: Milestone[]): Milestone[] {
  if (!Array.isArray(value)) return [...fallback];
  const kept = value.map(Number).filter((step) => ALLOWED.has(step)) as Milestone[];
  return kept.length > 0 ? kept : [...fallback];
}

function fromRow(row: Record<string, unknown> | undefined): NotificationPrefs {
  if (!row) return {...DEFAULT_PREFS};

  return {
    // `!== false` rather than `=== true`, so a column added after a row was
    // written defaults to on rather than silently off for existing people.
    muted: row.muted === true,
    socialFollow: row.social_follow !== false,
    socialReply: row.social_reply !== false,
    holdingsOn: row.holdings_on !== false,
    holdingsMultiples: asMilestones(row.holdings_multiples, DEFAULT_HOLDINGS_MULTIPLES),
    watchlistOn: row.watchlist_on === true,
    watchlistMultiples: asMilestones(row.watchlist_multiples, DEFAULT_WATCHLIST_MULTIPLES),
    graduationOn: row.graduation_on !== false,
    minPositionUsd:
      Number(row.min_position_usd) >= 0 ? Number(row.min_position_usd) : DEFAULT_PREFS.minPositionUsd,
    quietStart: typeof row.quiet_start === "string" ? row.quiet_start : null,
    quietEnd: typeof row.quiet_end === "string" ? row.quiet_end : null,
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "UTC",
  };
}

export async function prefsFor(userId: string): Promise<NotificationPrefs> {
  if (!hasAdminPg) return {...DEFAULT_PREFS};

  try {
    return await withClient(async (client) => {
      const {rows} = await client.query(
        "select * from public.notification_prefs where user_id = $1",
        [userId],
      );
      return fromRow(rows[0] as Record<string, unknown> | undefined);
    });
  } catch (error) {
    console.error("notification prefs read failed", error);
    return {...DEFAULT_PREFS};
  }
}

export async function savePrefs(
  userId: string,
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const next: NotificationPrefs = {...(await prefsFor(userId)), ...patch};
  if (!hasAdminPg) return next;

  await withClient((client) =>
    client.query(
      `insert into public.notification_prefs (
         user_id, muted, social_follow, social_reply,
         holdings_on, holdings_multiples, watchlist_on, watchlist_multiples,
         graduation_on, min_position_usd, quiet_start, quiet_end, timezone, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       on conflict (user_id) do update set
         muted = excluded.muted,
         social_follow = excluded.social_follow,
         social_reply = excluded.social_reply,
         holdings_on = excluded.holdings_on,
         holdings_multiples = excluded.holdings_multiples,
         watchlist_on = excluded.watchlist_on,
         watchlist_multiples = excluded.watchlist_multiples,
         graduation_on = excluded.graduation_on,
         min_position_usd = excluded.min_position_usd,
         quiet_start = excluded.quiet_start,
         quiet_end = excluded.quiet_end,
         timezone = excluded.timezone,
         updated_at = now()`,
      [
        userId,
        next.muted,
        next.socialFollow,
        next.socialReply,
        next.holdingsOn,
        next.holdingsMultiples,
        next.watchlistOn,
        next.watchlistMultiples,
        next.graduationOn,
        next.minPositionUsd,
        next.quietStart,
        next.quietEnd,
        next.timezone,
      ],
    ),
  );

  return next;
}
