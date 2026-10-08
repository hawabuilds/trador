"use client";

import {LaunchpadMark} from "./LaunchpadMark";
import {cn} from "@/lib/cn";
import type {LaunchpadId} from "@/lib/programs";

/**
 * A coin's artwork with its launchpad's mark in the corner.
 *
 * Which launchpad a coin came from is the second thing anyone wants to know
 * about it, and on a list it has to arrive at the same moment as the artwork
 * rather than a line below. Overlaid rather than placed beside it because a
 * row this dense has no horizontal room left, and because a mark that moves
 * with the picture reads as belonging to that coin.
 *
 * The ring is doing real work: these marks are a light pill and a dark square,
 * and a coin's artwork can be any colour at all. Without a border in the
 * page's own background the mark either disappears into the picture or looks
 * like part of it.
 *
 * Round, to match the artwork it sits on. A rounded square against a circle
 * reads as two different systems meeting at the corner, and the corner is
 * exactly where the eye lands.
 */
export function LaunchpadBadge({
  launchpad,
  size,
  children,
  className,
}: {
  launchpad: LaunchpadId;
  /** The avatar's size. The mark is scaled from it, never set separately. */
  size: number;
  children: React.ReactNode;
  className?: string;
}) {
  /*
   * Two fifths of the avatar, floored at 12px.
   *
   * Proportional so one component serves a 40px row and a 56px header, and
   * floored because below about 12px neither mark is recognisable — at which
   * point it is decoration that costs a request and tells nobody anything.
   */
  const mark = Math.max(12, Math.round(size * 0.4));

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {children}
      <span className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-[var(--surface-base)] p-[1.5px]">
        {/*
          The mark is rounded off with the ring. StonkFun's is a square tile and
          becomes a disc; pump.fun's is drawn to fill its box and is already
          round enough that nothing of it is lost.
        */}
        <LaunchpadMark launchpad={launchpad} size={mark} shape="circle" />
      </span>
    </span>
  );
}
