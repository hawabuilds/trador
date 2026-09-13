"use client";

import {launchpadFace} from "@/config/launchpads";
import {cn} from "@/lib/cn";
import type {LaunchpadId} from "@/lib/programs";

/**
 * A launchpad's real mark.
 *
 * This used to be a coloured square with an initial in it, on the reasoning
 * that a bad copy of someone's logo looks worse than a clean letter. That was
 * the wrong trade for a row whose whole job is telling two launchpads apart at
 * a glance: "S" and "P" in two similar greens is a distinction people have to
 * stop and decode, and the actual marks are instantly recognisable to anyone
 * who has used either site.
 *
 * So each launchpad now shows its own mark, and neither is invented:
 *
 *   - **StonkFun** ships as a PNG saved from their site. Bundled rather than
 *     hotlinked, so the row does not depend on their uptime and they do not
 *     receive a request for every coin anyone scrolls past.
 *   - **pump.fun** is drawn inline. Their assets sit behind Cloudflare, which
 *     403s anything it does not recognise — including, unpredictably, a real
 *     browser loading a cross-origin image — so a bundled or hotlinked file is
 *     a mark that sometimes silently is not there. Drawn, it cannot fail.
 */
export function LaunchpadMark({
  launchpad,
  size = 16,
  className,
}: {
  launchpad: LaunchpadId;
  size?: number;
  className?: string;
}) {
  const face = launchpadFace(launchpad);

  if (face.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={face.logo}
        alt=""
        aria-hidden="true"
        title={`Launched on ${face.label}`}
        width={size}
        height={size}
        style={{width: size, height: size}}
        className={cn("shrink-0 rounded-[5px] object-cover", className)}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <title>{`Launched on ${face.label}`}</title>
      {/*
        Two capsule halves on the diagonal — pump.fun's mark. Drawn as one
        rotated group so the split stays exactly on the pill's short axis at
        any size; rotating each half separately drifts by a pixel and the seam
        shows.
      */}
      <g transform="rotate(45 16 16)">
        <path d="M6 11a10 10 0 0 1 20 0v5H6z" fill="#4ade80" />
        <path d="M6 16h20v5a10 10 0 0 1-20 0z" fill="#e9fbf0" />
      </g>
    </svg>
  );
}
