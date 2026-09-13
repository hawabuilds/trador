/**
 * The theme, such as it is.
 *
 * Trador is **dark only**. There is no light palette, no `system` preference
 * and no toggle: every screen is a chart, a tape or a price, and all three are
 * read against a dark ground on every terminal people already use. A second
 * palette would be a second set of contrast ratios to keep honest for a surface
 * nobody trades on.
 *
 * This module is kept rather than deleted because a handful of callers still
 * need to *ask* what the theme is — Privy's modal takes an appearance, the
 * chart takes a background, the status bar takes a colour. They now get a
 * constant, which is the point: one answer, no resolution step, nothing to
 * disagree with the boot script in `app/layout.tsx`.
 *
 * When there were two themes, that disagreement was a real bug: the boot script
 * painted dark and the provider repainted from `prefers-color-scheme` a moment
 * later, so the feed was dark and every other tab was light.
 */

export type Theme = "dark";

/** The only theme. Exported as a value so callers do not hardcode the string. */
export const THEME: Theme = "dark";

/** Status bar / `theme-color` meta. Tracks `--bg-base`. */
export const THEME_COLOR = "#0A0A0C";

export function isTheme(value: string | null | undefined): value is Theme {
  return value === "dark";
}

/**
 * Put the theme on the document.
 *
 * Idempotent, and safe to call after the boot script has already done it. The
 * `light` class is removed rather than merely not added, so a browser that has
 * restored an old DOM — or a user who still has `trador.theme: "light"` in
 * localStorage from before this app was dark-only — lands somewhere coherent.
 */
export function applyThemeToDocument(): Theme {
  if (typeof document === "undefined") return THEME;

  const root = document.documentElement;
  root.classList.add("dark");
  root.classList.remove("light");
  root.style.colorScheme = "dark";
  root.dataset.theme = "dark";

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR);

  return THEME;
}
