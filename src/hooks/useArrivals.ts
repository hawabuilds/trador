"use client";

import {useEffect, useRef, useState} from "react";

/**
 * Which items have appeared since the last update.
 *
 * Lists here poll rather than stream, so without this a new row simply exists
 * between two frames and the eye misses it. What comes back is the set of ids
 * seen for the first time, which a list can use to animate exactly those rows.
 *
 * Ids present on the first load are recorded without being marked new. Marking
 * them animates the entire list on arrival, which reads as a loading state
 * rather than as activity.
 */
export function useArrivals(
  ids: string[],
  /** How long a row stays marked. Should outlast the animation, not the poll. */
  holdMs = 1200,
  /**
   * What the list *is*, as opposed to what is in it.
   *
   * When this changes the whole list is replaced — a different sort, tab or
   * filter — and every row in it is new to this hook. Without a reset each of
   * them played the arrival animation at once, so switching a filter made the
   * entire feed flash and slide, which read as the page glitching. A change of
   * key rebaselines silently; only coins that genuinely arrive afterwards, on a
   * poll of the same list, animate.
   */
  resetKey = "",
): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const lastReset = useRef(resetKey);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());

  // Joined so the effect compares contents rather than array identity: the
  // parent rebuilds this array on every render, and depending on the array
  // itself would re-run the effect forever.
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) return;

    if (seen.current === null || lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      seen.current = new Set(ids);
      setArrivals(new Set());
      return;
    }

    const fresh = ids.filter((id) => !seen.current!.has(id));
    if (fresh.length === 0) return;

    for (const id of fresh) seen.current.add(id);
    setArrivals(new Set(fresh));

    // Clear the marker once the animation has played, so a row that stays on
    // screen is not re-animated the next time React touches it.
    const timer = setTimeout(() => setArrivals(new Set()), holdMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, holdMs, resetKey]);

  return arrivals;
}
