/**
 * The rules that decide whether a phone buzzes.
 *
 * Tested hard because the failure modes are asymmetric. A notification that
 * never arrives is a missed moment. A wrong one that arrives repeatedly is how
 * a person disables the whole category and never re-enables it — so most of
 * what follows is about *not* sending.
 */

import {strict as assert} from "node:assert";
import {test} from "node:test";

import {
  consumeThrough,
  highestMilestone,
  multipleRatio,
} from "@/lib/notifications/milestones";
import {isQuiet, localMinutes} from "@/lib/notifications/quietHours";

const DEFAULTS = [2, 5, 10];

test("below 2x is not a milestone", () => {
  assert.equal(highestMilestone(1, DEFAULTS, []), null);
  assert.equal(highestMilestone(1.99, DEFAULTS, []), null);
  // A coin down 60% must never look like a milestone.
  assert.equal(highestMilestone(0.4, DEFAULTS, []), null);
});

test("the highest crossed rung is the one reported", () => {
  assert.equal(highestMilestone(2, DEFAULTS, []), 2);
  assert.equal(highestMilestone(4.9, DEFAULTS, []), 2);
  assert.equal(highestMilestone(5, DEFAULTS, []), 5);
  assert.equal(highestMilestone(60, DEFAULTS, []), 10);
});

/**
 * The rule that stops a reconciler from shouting.
 *
 * The indexer recomputes the same world every ninety seconds, and "up 5x" stays
 * true on every one of them. Without this a single good day would produce
 * hundreds of identical notifications.
 */
test("a rung that has fired never fires again", () => {
  assert.equal(highestMilestone(5, DEFAULTS, [5]), 2);
  assert.equal(highestMilestone(5, DEFAULTS, [2, 5]), null);
  assert.equal(highestMilestone(100, DEFAULTS, [2, 5, 10]), null);
});

test("only enabled rungs can fire", () => {
  assert.equal(highestMilestone(3, [2], []), 2);
  // 3 is crossed but not enabled, so 2 is still the answer.
  assert.equal(highestMilestone(3, [2, 3], []), 3);
  assert.equal(highestMilestone(50, [100], []), null);
});

/**
 * A jump across several rungs is one message, not four.
 *
 * Going 1.5x → 6x between sweeps crosses 2, 3 and 5. The person should hear
 * "up 5x" once, and the rungs below must be marked spent — otherwise the next
 * sweep cheerfully announces the 2x it passed half an hour ago.
 */
test("a multi-rung jump consumes the rungs beneath it", () => {
  const consumed = consumeThrough(5, [2, 3, 5, 10]);
  assert.deepEqual(consumed, [2, 3, 5]);
  // Having consumed them, nothing below fires next time.
  assert.equal(highestMilestone(6, [2, 3, 5, 10], consumed), null);
});

test("a ratio needs two positive, finite numbers", () => {
  assert.equal(multipleRatio(10, 5), 2);
  assert.equal(multipleRatio(10, 0), null);
  assert.equal(multipleRatio(0, 5), null);
  assert.equal(multipleRatio(10, -5), null);
  assert.equal(multipleRatio(Number.NaN, 5), null);
  assert.equal(multipleRatio(Number.POSITIVE_INFINITY, 5), null);
});

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

const utc = (hour: number, minute = 0): Date =>
  new Date(Date.UTC(2026, 0, 15, hour, minute));

test("no quiet window means never quiet", () => {
  const prefs = {quietStart: null, quietEnd: null, timezone: "UTC"};
  assert.equal(isQuiet(utc(3), prefs), false);
});

/**
 * One end without the other is an unfinished setting, not an instruction to go
 * silent forever — which is what treating the missing end as midnight would do.
 */
test("half a window is not a window", () => {
  assert.equal(isQuiet(utc(3), {quietStart: "22:00", quietEnd: null, timezone: "UTC"}), false);
  assert.equal(isQuiet(utc(3), {quietStart: null, quietEnd: "07:00", timezone: "UTC"}), false);
});

test("a daytime window behaves the obvious way", () => {
  const prefs = {quietStart: "09:00", quietEnd: "17:00", timezone: "UTC"};
  assert.equal(isQuiet(utc(8, 59), prefs), false);
  assert.equal(isQuiet(utc(9), prefs), true);
  assert.equal(isQuiet(utc(16, 59), prefs), true);
  // Exclusive at the end, so 17:00 is already loud again.
  assert.equal(isQuiet(utc(17), prefs), false);
});

/**
 * The case this function exists for.
 *
 * 22:00–07:00 is the window people actually pick, and a naive
 * `start <= now && now < end` gets it exactly backwards: it silences the entire
 * working day and lets the small hours through.
 */
test("an overnight window wraps midnight instead of inverting", () => {
  const prefs = {quietStart: "22:00", quietEnd: "07:00", timezone: "UTC"};

  assert.equal(isQuiet(utc(23), prefs), true, "23:00 is inside 22:00-07:00");
  assert.equal(isQuiet(utc(2), prefs), true, "02:00 is inside 22:00-07:00");
  assert.equal(isQuiet(utc(6, 59), prefs), true);

  assert.equal(isQuiet(utc(7), prefs), false, "07:00 is when it ends");
  assert.equal(isQuiet(utc(12), prefs), false, "midday must not be silenced");
  assert.equal(isQuiet(utc(21, 59), prefs), false);
});

test("quiet hours are read in the person's timezone, not the server's", () => {
  const prefs = {quietStart: "22:00", quietEnd: "07:00", timezone: "Asia/Tokyo"};

  // 15:00 UTC is midnight in Tokyo — quiet there, mid-afternoon in UTC.
  assert.equal(isQuiet(utc(15), prefs), true);
  assert.equal(isQuiet(utc(15), {...prefs, timezone: "UTC"}), false);
});

/**
 * An unreadable timezone fails toward delivery.
 *
 * A notification nobody wanted is recoverable; one that never arrives because a
 * stored string stopped parsing is not, and nothing would ever surface it.
 */
test("an unknown timezone does not silence everything", () => {
  assert.equal(localMinutes(utc(3), "Not/AZone"), null);
  assert.equal(
    isQuiet(utc(3), {quietStart: "22:00", quietEnd: "07:00", timezone: "Not/AZone"}),
    false,
  );
});
