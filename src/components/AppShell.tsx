"use client";

import dynamic from "next/dynamic";
import {useEffect, useRef, type ReactNode} from "react";
import {usePathname, useRouter} from "next/navigation";

import {useUser} from "@/hooks/useUser";
import {useRegisterMe} from "@/hooks/useRegisterMe";
import {saveReferral} from "@/lib/referral";
import {isPrivyOAuthReturn} from "@/lib/session";

import {cn} from "@/lib/cn";
import {PullIndicator, RefreshDock, useRefreshAll, usePullToRefresh} from "./Refresh";
import {TabBar} from "./TabBar";
import {
  HomeSearchKeptAlivePanels,
  KeptAliveProvider,
} from "./keptAlive/HomeSearchKeptAlive";

const PushPrompt = dynamic(() => import("./PushPrompt").then((m) => ({default: m.PushPrompt})), {
  ssr: false,
});

/**
 * Status bar / Dynamic Island inset, plus a little extra so titles do not sit
 * against the cutout. Lives on sticky headers and on other app pages — not on
 * the scroller, or a sticky `top: 0` would stack it twice.
 *
 * `phone-pad` is only given extra inset on the desktop phone stage, where it
 * stands in for the island inset a real phone reports through `env()`.
 */
export const APP_SCROLL_PAD_TOP =
  "phone-pad pt-[calc(26px+env(safe-area-inset-top,0px))]";

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
function isStonkfolioGuestPath(pathname: string): boolean {
  return pathname === "/stonkfolio" || pathname.startsWith("/stonkfolio/");
}

export function AppShell({children}: {children: ReactNode}) {
  const router = useRouter();
  const pathname = usePathname();
  const stonkfolioGuest = isStonkfolioGuestPath(pathname);
  const {ready, authenticated} = useUser();

  // Writes the signed-in person's row, once, so they can be followed and their
  // profile link resolves. Silent and fire-and-forget — see the hook.
  useRegisterMe();

  // Pull-to-refresh, on the one scroll container every screen shares.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const {refresh, refreshing} = useRefreshAll();
  const pull = usePullToRefresh(scrollerRef, refresh);

  /**
   * Send a signed-out visitor to the door.
   *
   * Three guards, each for a real failure:
   *
   *   - `ready` first, because Privy reports `authenticated: false` while it is
   *     still restoring a session. Redirecting on that bounces a signed-in
   *     person out on every cold load.
   *   - An OAuth return is exempt: the provider hands control back before the
   *     session exists, and redirecting at that exact moment is how a login
   *     loop starts.
   *   - A blank hold while resolving, rather than rendering the feed and
   *     yanking it away — a flash of content you are not allowed to see reads
   *     as a bug even when the redirect is correct.
   */
  useEffect(() => {
    if (!ready || authenticated) return;
    if (isPrivyOAuthReturn()) return;
    if (stonkfolioGuest) return;
    /*
     * A signed-out visitor on someone's profile arrived through a shared
     * link: that person is their inviter. Remember them before the redirect,
     * or the sign-up page has no idea who sent them.
     */
    const inviter = /^\/u\/([^/?#]+)/.exec(window.location.pathname)?.[1];
    if (inviter) {
      const handle = decodeURIComponent(inviter);
      saveReferral(handle);
      router.replace(`/?ref=${encodeURIComponent(handle)}`);
      return;
    }
    router.replace("/");
  }, [ready, authenticated, router, stonkfolioGuest]);

  /*
   * Privy still restoring a session: render the shell and route content now.
   * Wallet-gated actions stay disabled in their own components until `ready`.
   * Only a confirmed signed-out visitor is held back while the redirect runs.
   */
  if (ready && !authenticated && !isPrivyOAuthReturn() && !stonkfolioGuest) {
    return (
      <div
        className={`${APP_SCROLL_PAD_TOP} h-full animate-pulse space-y-4 bg-surface-base px-[22px]`}
        aria-busy
        aria-label="Loading"
      >
        <div className="h-8 w-40 rounded-md bg-surface-raised" />
        <div className="h-64 rounded-xl bg-surface-raised" />
      </div>
    );
  }

  return (
    <KeptAliveProvider>
      <div className="flex h-full flex-col bg-surface-base">
        <PullIndicator pull={pull} refreshing={refreshing} />
        <div
          ref={scrollerRef}
          className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pb-[calc(96px+env(safe-area-inset-bottom))]"
          style={{
            // The list follows the finger, which is what makes the gesture feel
            // like it is moving the content rather than playing an animation.
            transform: pull > 0 ? `translateY(${pull * 0.6}px)` : undefined,
            transition: pull === 0 ? "transform 220ms ease" : undefined,
          }}
        >
          {children}
          <HomeSearchKeptAlivePanels />
        </div>

        <TabBar />
        <RefreshDock refresh={refresh} refreshing={refreshing} />
        <PushPrompt />
      </div>
    </KeptAliveProvider>
  );
}
