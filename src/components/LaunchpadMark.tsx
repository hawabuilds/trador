"use client";

import {cn} from "@/lib/cn";
import {LAUNCHPADS, type LaunchpadId} from "@/lib/programs";

/**
 * Brand colours for the two launchpads.
 *
 * A colour and an initial rather than a bundled logo file: both marks are
 * someone else's trademark, and a wrong-looking copy of a logo reads worse than
 * a clean initial. The colour is enough to tell the two apart at a glance,
 * which is all the row needs.
 */
const MARKS: Record<LaunchpadId, {color: string; initial: string}> = {
  stonkfun: {color: "#16C784", initial: "S"},
  pumpfun: {color: "#54D194", initial: "P"},
};

export function LaunchpadMark({
  launchpad,
  size = 16,
  className,
}: {
  launchpad: LaunchpadId;
  size?: number;
  className?: string;
}) {
  const mark = MARKS[launchpad];

  return (
    <span
      aria-hidden="true"
      title={`Launched on ${LAUNCHPADS[launchpad].label}`}
      style={{width: size, height: size, backgroundColor: mark.color}}
      className={cn(
        "grid shrink-0 place-items-center rounded-[5px] font-extrabold text-[#06140C]",
        className,
      )}
    >
      <span style={{fontSize: Math.round(size * 0.62)}}>{mark.initial}</span>
    </span>
  );
}
