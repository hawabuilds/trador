/**
 * Whether now falls inside someone's quiet hours.
 *
 * Separated and pure because the interesting case is the one that wraps
 * midnight — 22:00 to 07:00 is the setting people actually choose, and it is
 * the one a naive `start <= now && now < end` comparison gets exactly backwards,
 * silencing the whole day instead of the night.
 */

/** `HH:MM` in 24-hour time, or null. */
export type ClockTime = string | null;

function minutesOf(value: ClockTime): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * The local wall-clock minute in a timezone, without pulling in a date library.
 *
 * `Intl` already knows every zone the platform does, and formatting to
 * `en-GB` hour/minute is the cheapest way to ask it. An unknown zone throws,
 * and the caller treats that as "not quiet" — failing toward delivery rather
 * than toward silence, because a notification nobody wanted is recoverable and
 * one that never arrives is not.
 */
export function localMinutes(at: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(at);

    const hour = parts.find((part) => part.type === "hour")?.value;
    const minute = parts.find((part) => part.type === "minute")?.value;
    if (hour === undefined || minute === undefined) return null;

    // `en-GB` renders midnight as "24" in some runtimes.
    return (Number(hour) % 24) * 60 + Number(minute);
  } catch {
    return null;
  }
}

export function isQuiet(
  at: Date,
  prefs: {quietStart: ClockTime; quietEnd: ClockTime; timezone: string},
): boolean {
  const start = minutesOf(prefs.quietStart);
  const end = minutesOf(prefs.quietEnd);
  // Both ends are required. One without the other is an unfinished setting, not
  // an instruction to go quiet forever.
  if (start === null || end === null) return false;
  if (start === end) return false;

  const now = localMinutes(at, prefs.timezone);
  if (now === null) return false;

  /*
   * The wrap case. 22:00-07:00 means "after 22:00 **or** before 07:00", while
   * 09:00-17:00 means "after 09:00 **and** before 17:00". Using one comparison
   * for both silences the entire day for anyone who picked an overnight window
   * — which is everyone who picks one at all.
   */
  return start < end ? now >= start && now < end : now >= start || now < end;
}
