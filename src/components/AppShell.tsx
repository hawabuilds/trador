import type {ReactNode} from "react";

import {cn} from "@/lib/cn";
import {TabBar} from "./TabBar";

/**
 * Status bar / Dynamic Island inset, plus a little extra so titles do not sit
 * against the cutout. Lives on sticky headers and on other app pages — not on
 * the scroller, or a sticky `top: 0` would stack it twice.
 */
export const APP_SCROLL_PAD_TOP =
  "pt-[calc(26px+env(safe-area-inset-top,0px))]";

/**
 * Title + filter block that stays put while the feed scrolls.
 *
 * The background must be opaque and must be painted explicitly: the safe-area
 * padding lives on this bar so titles sit in the same place at rest and while
 * stuck, and without a solid fill the rows scroll visibly through it.
 */
export function StickyPageHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-[22px] px-[22px] shadow-[0_8px_24px_-20px_var(--shadow-color)]",
        APP_SCROLL_PAD_TOP,
        className,
      )}
      style={{backgroundColor: "var(--surface-base)"}}
    >
      {children}
    </div>
  );
}

/**
 * The app frame: one scroll container, with the tab bar floating over it.
 *
 * The bottom padding clears the floating bar. It is easy to miss on a desktop
 * browser at full height and immediately obvious on a phone, where the last
 * row of the feed ends up underneath the navigation.
 */
export function AppShell({children}: {children: ReactNode}) {
  return (
    <div className="flex h-full flex-col bg-surface-base">
      <div className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <TabBar />
    </div>
  );
}
