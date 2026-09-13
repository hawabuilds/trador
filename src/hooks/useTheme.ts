import {THEME, type Theme} from "@/lib/theme";

/**
 * The current theme, which is always `"dark"`.
 *
 * Kept as a hook rather than inlining the constant at each call site, so the
 * places that genuinely need to hand an appearance to something else — Privy's
 * modal, the chart's background, the share card — keep reading as if they are
 * asking a question. If a light mode ever comes back, they do not change.
 */
export function useTheme(): {theme: Theme} {
  return {theme: THEME};
}
