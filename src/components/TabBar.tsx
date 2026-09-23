"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {usePathname, useRouter} from "next/navigation";

import {TABS, type TabKey} from "@/config/app";
import {cn} from "@/lib/cn";
import {CapIcon, HomeIcon, NewsIcon, SearchIcon, WalletIcon} from "./ui/Icons";

const ICONS: Record<TabKey, (props: {className?: string}) => JSX.Element> = {
  home: HomeIcon,
  search: SearchIcon,
  news: NewsIcon,
  learn: CapIcon,
  stonkfolio: WalletIcon,
};

/**
 * The primary navigation.
 *
 * A floating bar rather than a full-width one: it reads as a control sitting
 * over the feed instead of a frame around it, and content scrolling visibly
 * under its blurred edges is what makes the app feel like a surface rather than
 * a page.
 *
 * Icons only, with the labels in `aria-label` for anyone who needs them.
 */
export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Which tab to paint as current.
   *
   * `usePathname` only moves once the navigation commits, so the highlight
   * otherwise sits on the old tab for as long as the route takes to resolve.
   * That reads as a dropped tap, and a second tap is the usual response. Paint
   * the pressed tab immediately and let the real pathname take over when it
   * lands.
   */
  const [pressed, setPressed] = useState<string | null>(null);
  useEffect(() => setPressed(null), [pathname]);

  const current = pressed ?? pathname;

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-[22px] bottom-[calc(14px+env(safe-area-inset-bottom))]"
    >
      <div
        data-surface="popup"
        className={cn(
          "pointer-events-auto flex items-center gap-1 rounded-full p-1.5",
          "bg-surface-popup/80 shadow-panel backdrop-blur-[22px]",
        )}
      >
        {TABS.map((tab) => {
          const Icon = ICONS[tab.key];
          const active =
            current === tab.href || current.startsWith(`${tab.href}/`);

          const prefetchRoute = tab.key === "home" || tab.key === "search";

          return (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch={prefetchRoute}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              onPointerDown={() => {
                setPressed(tab.href);
                if (prefetchRoute) router.prefetch(tab.href);
              }}
              className={cn(
                "grid h-[46px] w-[48px] place-items-center rounded-full",
                // Snap the highlight on rather than easing it: at 200ms the
                // fade is itself most of the delay people feel on tap.
                "transition-[background-color,color,box-shadow] duration-100",
                active
                  ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                  : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
              )}
            >
              <Icon className="h-[21px] w-[21px]" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
