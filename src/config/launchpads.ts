/**
 * How each launchpad is presented, and where its coins live.
 *
 * `lib/programs.ts` owns the *proof* — which program and which platform config
 * make a coin StonkFun's rather than pump.fun's. This file owns the *face*: the
 * mark, and the deep link to that launchpad's own page for a given mint. The
 * split matters, because attribution must never be influenced by presentation:
 * a coin is StonkFun's because of a platform config at byte 173, not because
 * someone put a sock in its metadata.
 *
 * The URL patterns were read off the real sites rather than assumed — StonkFun
 * links its coins as `/token/<mint>`, which is not the `/coin/<mint>` that
 * pump.fun uses, and guessing would have produced two chips where one 404s.
 */

import type {LaunchpadId} from "@/lib/programs";
import {LAUNCHPADS} from "@/lib/programs";

export interface LaunchpadFace {
  readonly label: string;
  /** The launchpad's home page. */
  readonly site: string;
  /** That launchpad's own page for one coin. */
  readonly coinUrl: (mint: string) => string;
  /**
   * A bundled logo file, or null when the mark is drawn inline.
   *
   * Bundled rather than hotlinked. pump.fun sits behind Cloudflare and returns
   * 403 to anything that is not a browser it likes — including, unpredictably,
   * a user's own browser loading a cross-origin image — so an `<img>` pointed
   * at their CDN is a chip that sometimes silently has no logo.
   */
  readonly logo: string | null;
  /** Alt text. Empty when the chip's own label already names it. */
  readonly alt: string;
}

export const LAUNCHPAD_FACES: Record<LaunchpadId, LaunchpadFace> = {
  stonkfun: {
    label: LAUNCHPADS.stonkfun.label,
    site: "https://www.stonkfun.xyz",
    coinUrl: (mint) => `https://www.stonkfun.xyz/token/${mint}`,
    // Their own mark, saved from the site so the chip does not depend on their
    // uptime and no third party sees a request for every row we render.
    logo: "/launchpads/stonkfun.png",
    alt: "StonkFun",
  },
  pumpfun: {
    label: LAUNCHPADS.pumpfun.label,
    site: "https://pump.fun",
    coinUrl: (mint) => `https://pump.fun/coin/${mint}`,
    logo: null,
    alt: "pump.fun",
  },
};

export function launchpadFace(id: LaunchpadId): LaunchpadFace {
  return LAUNCHPAD_FACES[id];
}
