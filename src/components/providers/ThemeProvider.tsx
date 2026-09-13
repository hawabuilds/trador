"use client";

import {useEffect, type ReactNode} from "react";

import {applyThemeToDocument} from "@/lib/theme";

/**
 * Pins the document to the dark theme.
 *
 * The app is dark only, so this is not a provider in the usual sense — there is
 * no state, no context and nothing to switch. It exists to run
 * `applyThemeToDocument` once on mount, which repairs the two cases the boot
 * script in `app/layout.tsx` cannot: a user who still has `trador.theme:
 * "light"` in localStorage from when there were two themes, and a
 * back/forward-cache restore that brings back an older `<html>`.
 *
 * `useTheme` is the hook to call if you need the value; it returns a constant.
 */
export function ThemeProvider({children}: {children: ReactNode}) {
  useEffect(() => {
    applyThemeToDocument();
  }, []);

  return <>{children}</>;
}
