/**
 * What actually produces a notification.
 *
 * Each function here decides *whether* something happened and hands a finished
 * message to `dispatch`, which decides whether to deliver it. Keeping those
 * apart is what stops "did this happen" and "does this person want it" from
 * getting tangled — every caller below can be read as a description of an event
 * and nothing else.
 */

import {
  consumeThrough,
  highestMilestone,
  multipleRatio,
} from "@/lib/notifications/milestones";
import {compactMoney} from "@/lib/format";
import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {consumeRungs, dispatch, type DispatchOutcome} from "./dispatch";
import {prefsFor} from "./prefs";

/** Someone followed you. */
export async function notifyFollowed(
  followeeId: string,
  followerHandle: string,
  followerName: string,
): Promise<DispatchOutcome> {
  return dispatch({
    userId: followeeId,
    kind: "follow",
    // The follower is the subject, so one person following you twice — unfollow
    // then refollow — does not buzz twice.
    subject: followerHandle,
    payload: {
      title: "New follower",
      body: `${followerName} followed you`,
      url: `/u/${followerHandle}`,
    },
  });
}

/** Someone replied to your comment. */
export async function notifyReplied(
  authorId: string,
  replierName: string,
  assetKind: "stonk" | "stock",
  assetId: string,
  commentId: string,
): Promise<DispatchOutcome> {
  return dispatch({
    userId: authorId,
    kind: "reply",
    // The comment is the subject, so each distinct reply is its own event.
    subject: commentId,
    payload: {
      title: `${replierName} replied`,
      body: "Someone replied to your comment",
      url: `/${assetKind}/${assetId}`,
    },
  });
}

/**
 * A coin someone holds crossed a multiple of what they paid.
 *
 * `reference` is their cost basis and `mark` the current price. Both are
 * required to be real positive numbers by `multipleRatio`, so a coin with no
 * price cannot produce a notification claiming it went up.
 */
export async function notifyHoldingMultiple(input: {
  userId: string;
  mint: string;
  symbol: string;
  mark: number;
  reference: number;
  positionUsd: number;
}): Promise<DispatchOutcome> {
  const prefs = await prefsFor(input.userId);

  /*
   * Below the threshold, nothing — and the rungs are *not* consumed.
   *
   * Someone holding $3 of a coin that went 10x made $27, and a buzz for it
   * teaches them to disable the category. But if they buy more later, the same
   * milestone becomes worth hearing about, so it must still be available.
   */
  if (input.positionUsd < prefs.minPositionUsd) return "disabled";

  const ratio = multipleRatio(input.mark, input.reference);
  if (ratio === null) return "disabled";

  const fired = await firedRungs(input.userId, "holding_multiple", input.mint);
  const rung = highestMilestone(ratio, prefs.holdingsMultiples, fired);
  if (rung === null) return "duplicate";

  const outcome = await dispatch({
    userId: input.userId,
    kind: "holding_multiple",
    subject: input.mint,
    rung,
    payload: {
      title: `${input.symbol} is up ${rung}x`,
      body: `Your position is worth ${compactMoney(input.positionUsd)}`,
      url: `/stonk/${input.mint}`,
    },
  });

  // Mark the rungs beneath as spent, so a jump does not trickle out later.
  if (outcome === "sent") {
    const lower = consumeThrough(rung, prefs.holdingsMultiples).filter((step) => step !== rung);
    await consumeRungs(input.userId, "holding_multiple", input.mint, lower);
  }

  return outcome;
}

/**
 * A coin is nearly through its bonding curve.
 *
 * Trador's own event, and the reason to keep the tab open. Fires once, at 90%,
 * for anyone watching the coin — past that the window to buy before it migrates
 * is short, which is the whole point of telling someone.
 */
export const GRADUATING_SOON_AT = 0.9;

export async function notifyGraduatingSoon(input: {
  userId: string;
  mint: string;
  symbol: string;
  progress: number;
}): Promise<DispatchOutcome> {
  if (input.progress < GRADUATING_SOON_AT) return "disabled";

  return dispatch({
    userId: input.userId,
    kind: "graduating_soon",
    subject: input.mint,
    payload: {
      title: `${input.symbol} is close to graduating`,
      body: `${Math.round(input.progress * 100)}% of the way through its curve`,
      url: `/stonk/${input.mint}`,
    },
  });
}

/** A coin someone watches or holds finished its curve and now trades in a pool. */
export async function notifyGraduated(input: {
  userId: string;
  mint: string;
  symbol: string;
  quoteTicker: string;
}): Promise<DispatchOutcome> {
  return dispatch({
    userId: input.userId,
    kind: "graduation",
    subject: input.mint,
    payload: {
      title: `${input.symbol} graduated`,
      body: `Now trading in a pool against ${input.quoteTicker}`,
      url: `/stonk/${input.mint}`,
    },
  });
}

/** Which rungs have already been spent for this person and subject. */
async function firedRungs(
  userId: string,
  kind: string,
  subject: string,
): Promise<number[]> {
  if (!hasAdminPg) return [];

  try {
    return await withClient(async (client) => {
      const {rows} = await client.query(
        `select rung from public.notification_events
          where user_id = $1 and kind = $2 and subject = $3`,
        [userId, kind, subject],
      );
      return rows.map((row) => Number(row.rung));
    });
  } catch {
    /*
     * An empty list on failure would re-send everything. Returning every rung
     * as spent is the safe direction: a missed notification is recoverable, a
     * storm of duplicates is what makes someone disable the category.
     */
    return [2, 3, 5, 10, 25, 50, 100];
  }
}
