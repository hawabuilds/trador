"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {usePathname} from "next/navigation";
import {useQueryClient} from "@tanstack/react-query";

import {cn} from "@/lib/cn";
import {RefreshIcon} from "./ui/Icons";

/**
 * Refreshing, the way a phone app does it: pull the list down, or tap the
 * button beside the dock.
 *
 * The header was the wrong place for it. It is the furthest point from a thumb
 * on a phone, and on the feed it sat next to Create — a small grey icon
 * competing with the one button the screen is built around.
 *
 * So: the gesture is the main way in, because it is where the hand already is
 * and costs no pixels; and the button sits at the bottom right, on the dock's
 * own line and made of the dock's material, which is both the easiest place to
 * reach one-handed and somewhere it reads as part of the furniture rather than
 * as clutter over the feed.
 */

/** How far the list has to come down before letting go refreshes. */
const THRESHOLD = 64;
/** The most it will stretch, however hard it is pulled. */
const MAX_PULL = 96;
/** A refresh that returns identical data still has to look like it happened. */
const MIN_SPIN_MS = 600;

/** Refetch everything the current screen is using. */
export function useRefreshAll(): {refresh: () => Promise<void>; refreshing: boolean} {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const started = Date.now();
    try {
      await queryClient.refetchQueries({type: "active"});
    } finally {
      const rest = Math.max(0, MIN_SPIN_MS - (Date.now() - started));
      await new Promise((resolve) => window.setTimeout(resolve, rest));
      busy.current = false;
      setRefreshing(false);
    }
  }, [queryClient]);

  return {refresh, refreshing};
}

/**
 * Pull-to-refresh on the app's one scroll container.
 *
 * Only from the very top, and only downward, so it can never fight a scroll
 * that is already underway. The pull is damped — half a finger's travel — which
 * is what stops it feeling like the page has come loose.
 */
export function usePullToRefresh(
  ref: React.RefObject<HTMLElement>,
  onRefresh: () => Promise<void>,
): number {
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const refreshing = useRef(false);

  const set = useCallback((next: number) => {
    pullRef.current = next;
    setPull(next);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let startY: number | null = null;
    let tracking = false;

    const onStart = (event: TouchEvent) => {
      if (element.scrollTop > 0 || refreshing.current || event.touches.length !== 1) return;
      startY = event.touches[0].clientY;
      tracking = true;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || startY === null) return;
      const dy = event.touches[0].clientY - startY;
      // Scrolled away from the top, or pulling up: this is an ordinary scroll.
      if (dy <= 0 || element.scrollTop > 0) {
        tracking = false;
        set(0);
        return;
      }
      // Cancels the browser's own overscroll bounce, so only one thing moves.
      event.preventDefault();
      set(Math.min(MAX_PULL, dy * 0.5));
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      startY = null;
      if (pullRef.current < THRESHOLD) {
        set(0);
        return;
      }
      // Held at the threshold while it works, then released — the same shape
      // as every other pull-to-refresh anyone has used.
      refreshing.current = true;
      set(THRESHOLD);
      void onRefresh().finally(() => {
        refreshing.current = false;
        set(0);
      });
    };

    element.addEventListener("touchstart", onStart, {passive: true});
    element.addEventListener("touchmove", onMove, {passive: false});
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, onRefresh, set]);

  return pull;
}

/** The spinner that follows the pull down from under the status bar. */
export function PullIndicator({pull, refreshing}: {pull: number; refreshing: boolean}) {
  const progress = Math.min(1, pull / THRESHOLD);
  if (pull <= 0 && !refreshing) return null;

  return (
    <div
      aria-hidden="true"
      className="phone-pull pointer-events-none absolute inset-x-0 z-30 flex justify-center top-[calc(10px+env(safe-area-inset-top,0px))]"
      style={{
        transform: `translateY(${pull * 0.6}px)`,
        opacity: refreshing ? 1 : progress,
        transition: pull === 0 ? "transform 220ms ease, opacity 220ms ease" : undefined,
      }}
    >
      <span
        data-surface="popup"
        className="grid h-8 w-8 place-items-center rounded-full bg-surface-popup/85 text-muted shadow-panel backdrop-blur-[22px]"
      >
        <RefreshIcon
          className={cn("h-[15px] w-[15px]", refreshing && "animate-spin")}
          style={refreshing ? undefined : {transform: `rotate(${progress * 270}deg)`}}
        />
      </span>
    </div>
  );
}

/**
 * The feed only.
 *
 * A floating button sits over whatever is beneath it, and on a coin's page
 * that is the Buy and Sell pair — a refresh control that can land on Sell is
 * not worth the convenience. Those pages get `RefreshChip` in the chart's own
 * control row instead.
 */
function wantsButton(pathname: string): boolean {
  return pathname.startsWith("/home");
}

/**
 * The refresh button, sitting beside the dock.
 *
 * Same surface, blur and shadow as the tab bar, floating just above its right
 * end: inside the thumb's arc on a phone, clear of the dock's own hit targets,
 * and far from anything it could be mistaken for.
 */
export function RefreshDock({refresh, refreshing}: {refresh: () => Promise<void>; refreshing: boolean}) {
  const pathname = usePathname();
  if (!wantsButton(pathname)) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-end px-[22px] bottom-[calc(82px+env(safe-area-inset-bottom))]">
      <button
        type="button"
        data-surface="popup"
        onClick={() => void refresh()}
        aria-label="Refresh"
        aria-busy={refreshing}
        className={cn(
          "pointer-events-auto grid h-11 w-11 place-items-center rounded-full",
          "bg-surface-popup/80 text-muted shadow-panel backdrop-blur-[22px]",
          "transition-colors hover:text-ink active:scale-95",
        )}
      >
        <RefreshIcon className={cn("h-[18px] w-[18px]", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}

/**
 * The same refresh, sized to sit in a row of controls.
 *
 * Used on a coin's page, in the line that already holds the timeframes and the
 * chart style — beside what it updates, and over nothing.
 */
export function RefreshChip({label = "Refresh"}: {label?: string}) {
  const {refresh, refreshing} = useRefreshAll();

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      aria-label={label}
      aria-busy={refreshing}
      className={cn(
        "grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full",
        "bg-[var(--segment-track)] text-muted shadow-inset-soft",
        "transition-colors hover:text-ink",
      )}
    >
      <RefreshIcon className={cn("h-[15px] w-[15px]", refreshing && "animate-spin")} />
    </button>
  );
}
