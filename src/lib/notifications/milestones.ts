/**
 * When a price move is worth interrupting someone for.
 *
 * Pure, and tested, because the failure modes are asymmetric. Failing to send a
 * notification is a missed moment; sending the wrong one repeatedly is how a
 * person turns the whole category off and never turns it back on. So the rules
 * here are about *not* sending: one message per rung per subject, ever, and a
 * jump across several rungs is one message rather than four.
 */

/** Multiples that can fire. Ordered, because the highest crossed is reported. */
export const MILESTONES = [2, 3, 5, 10, 25, 50, 100] as const;
export type Milestone = (typeof MILESTONES)[number];

export const DEFAULT_HOLDINGS_MULTIPLES: Milestone[] = [2, 5, 10];
export const DEFAULT_WATCHLIST_MULTIPLES: Milestone[] = [2, 5, 10];

/**
 * The highest enabled rung at or below `ratio` that has not already fired.
 *
 * Returns null below 2x — a coin up 40% has not hit a milestone — and null when
 * every rung it crossed is already spent.
 */
export function highestMilestone(
  ratio: number,
  enabled: readonly number[],
  alreadyFired: readonly number[],
): Milestone | null {
  if (!Number.isFinite(ratio) || ratio < 2) return null;

  const allow = new Set(enabled);
  const fired = new Set(alreadyFired);
  let hit: Milestone | null = null;

  for (const step of MILESTONES) {
    if (!allow.has(step)) continue;
    // A hair of tolerance, so a mark that computes to 4.999999999 for a coin
    // that is genuinely at 5x does not wait for the next tick.
    if (ratio + 1e-9 < step) break;
    if (fired.has(step)) continue;
    hit = step;
  }

  return hit;
}

/**
 * Every rung a jump consumed, including ones that never fired.
 *
 * A coin that goes from 1.5x to 6x between two sweeps crossed 2, 3 and 5. It
 * should produce **one** notification — "up 5x" — and the lower rungs must be
 * marked spent, or the next sweep would helpfully announce the 2x it passed
 * half an hour ago.
 */
export function consumeThrough(
  reached: Milestone,
  enabled: readonly number[],
): Milestone[] {
  const allow = new Set(enabled);
  return MILESTONES.filter((step) => allow.has(step) && step <= reached);
}

/** `mark / reference`, or null when either side cannot support a ratio. */
export function multipleRatio(mark: number, reference: number): number | null {
  if (!Number.isFinite(mark) || !Number.isFinite(reference)) return null;
  if (reference <= 0 || mark <= 0) return null;
  return mark / reference;
}
