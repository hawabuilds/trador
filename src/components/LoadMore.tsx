"use client";

import {useEffect, useRef} from "react";

/**
 * The bottom of an endless list.
 *
 * An `IntersectionObserver` on an empty div rather than a scroll listener: a
 * scroll handler fires on every frame of a flick and has to be throttled, and
 * getting that wrong on a feed shows up as a stutter exactly when somebody is
 * moving fast through it.
 *
 * `rootMargin` starts the fetch 400px before the sentinel is visible, so the
 * next page is usually already in the list by the time the previous one runs
 * out. The alternative — loading when the spinner appears — means every page
 * boundary is a visible stall.
 *
 * A **button is rendered as well**, not instead. The observer never fires for
 * someone navigating by keyboard, and an infinite list with no reachable
 * control is a list those people cannot reach the end of. It is the same
 * action, so nothing is lost by having both.
 */
export function LoadMore({
  onLoad,
  loading,
  label = "Load more",
}: {
  onLoad: () => void;
  loading: boolean;
  label?: string;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  /*
   * The callback is read through a ref rather than listed as a dependency.
   *
   * `onLoad` is rebuilt on every render of the parent — it closes over the
   * cursor, which changes with each page — so depending on it would tear down
   * and rebuild the observer constantly, and an observer created mid-scroll can
   * miss the intersection that was already happening.
   */
  const latest = useRef(onLoad);
  useEffect(() => {
    latest.current = onLoad;
  }, [onLoad]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      {rootMargin: "400px 0px"},
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={sentinel} className="flex justify-center py-6">
      <button
        type="button"
        onClick={onLoad}
        disabled={loading}
        className="rounded-full bg-[var(--overlay-wash)] px-4 py-2 text-[12.5px] font-extrabold text-muted transition-colors hover:text-ink disabled:opacity-60"
      >
        {loading ? "Loading…" : label}
      </button>
    </div>
  );
}
