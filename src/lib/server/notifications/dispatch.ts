/**
 * The one door every notification goes through.
 *
 * Centralised so the rules cannot be forgotten by a caller. There are four, and
 * each exists because skipping it produces a specific, unrecoverable annoyance:
 *
 *   1. **Muted wins.** One switch, checked first, so "make it stop" is a single
 *      tap that works immediately and completely.
 *   2. **Quiet hours are respected but not queued.** A held notification that
 *      arrives at 07:00 is stale news about an overnight move; the point of
 *      quiet hours is to not be woken, not to get a digest.
 *   3. **Once per rung, ever.** The indexer is a reconciler — it recomputes the
 *      same world every ninety seconds, and "up 5x" stays true on all of them.
 *      Without the ledger a single good day is hundreds of identical buzzes.
 *   4. **Claim before send.** The row is inserted *first*, so two passes racing
 *      each other cannot both win. A duplicate insert loses harmlessly.
 */

import {isQuiet} from "@/lib/notifications/quietHours";
import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {prefsFor, type NotificationPrefs} from "./prefs";
import {sendWebPush, type PushPayload} from "./push";

export type NotificationKind =
  | "follow"
  | "reply"
  | "holding_multiple"
  | "watchlist_multiple"
  | "graduation"
  | "graduating_soon";

export interface Notification {
  userId: string;
  kind: NotificationKind;
  /** A mint, a handle — whatever identifies the thing this is about. */
  subject: string;
  /** The milestone multiple, or 0 for events with no magnitude. */
  rung?: number;
  payload: PushPayload;
}

export type DispatchOutcome =
  | "sent"
  | "muted"
  | "quiet"
  | "disabled"
  | "duplicate"
  | "no-store";

/** Whether this person wants this kind at all. */
function wants(prefs: NotificationPrefs, kind: NotificationKind): boolean {
  switch (kind) {
    case "follow":
      return prefs.socialFollow;
    case "reply":
      return prefs.socialReply;
    case "holding_multiple":
      return prefs.holdingsOn;
    case "watchlist_multiple":
      return prefs.watchlistOn;
    case "graduation":
    case "graduating_soon":
      return prefs.graduationOn;
  }
}

/**
 * Record that this exact notification is being sent, returning false if it
 * already was.
 *
 * `on conflict do nothing` with a checked row count, rather than a read then a
 * write. Two sweeps can overlap, and a read-then-write would let both see an
 * empty ledger and both send.
 */
async function claim(
  userId: string,
  kind: NotificationKind,
  subject: string,
  rung: number,
): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query(
      `insert into public.notification_events (user_id, kind, subject, rung)
       values ($1, $2, $3, $4)
       on conflict (user_id, kind, subject, rung) do nothing`,
      [userId, kind, subject, rung],
    );
    return (result.rowCount ?? 0) > 0;
  });
}

/**
 * Mark rungs as spent without sending anything.
 *
 * A jump from 1.5x to 6x crosses 2, 3 and 5. The person hears about 5 once, and
 * the rest have to be recorded or the next sweep announces the 2x it passed
 * half an hour ago.
 */
export async function consumeRungs(
  userId: string,
  kind: NotificationKind,
  subject: string,
  rungs: readonly number[],
): Promise<void> {
  if (!hasAdminPg || rungs.length === 0) return;

  try {
    for (const rung of rungs) {
      await claim(userId, kind, subject, rung);
    }
  } catch (error) {
    console.error("consuming rungs failed", error);
  }
}

export async function dispatch(
  notification: Notification,
  now: Date = new Date(),
): Promise<DispatchOutcome> {
  if (!hasAdminPg) return "no-store";

  const {userId, kind, subject, payload} = notification;
  const rung = notification.rung ?? 0;

  try {
    const prefs = await prefsFor(userId);

    if (prefs.muted) return "muted";
    if (!wants(prefs, kind)) return "disabled";

    /*
     * Quiet hours are checked before the claim, deliberately.
     *
     * Claiming first would burn the rung — the person would never hear about
     * that milestone at all, rather than hearing about it when they wake up if
     * it is still true.
     */
    if (isQuiet(now, prefs)) return "quiet";

    if (!(await claim(userId, kind, subject, rung))) return "duplicate";

    await sendWebPush(userId, payload);
    return "sent";
  } catch (error) {
    // A dispatch failure must never fail the pass that triggered it. The
    // indexer's job is the universe; this is decoration on top of it.
    console.error("notification dispatch failed", error);
    return "no-store";
  }
}
