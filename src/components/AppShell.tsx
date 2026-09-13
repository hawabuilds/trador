"use client";

import {useEffect, type ReactNode} from "react";
import {useRouter} from "next/navigation";

import {useUser} from "@/hooks/useUser";
import {useRegisterMe} from "@/hooks/useRegisterMe";
import {isPrivyOAuthReturn} from "@/lib/session";

import {cn} from "@/lib/cn";
import {PushPrompt} from "./PushPrompt";
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
  const router = useRouter();
  const {ready, authenticated} = useUser();

  // Writes the signed-in person's row, once, so they can be followed and their
  // profile link resolves. Silent and fire-and-forget — see the hook.
  useRegisterMe();

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
    router.replace("/");
  }, [ready, authenticated, router]);

  if (!ready || (!authenticated && !isPrivyOAuthReturn())) {
    return <div className="h-full bg-surface-base" />;
  }

  return (
    <div className="flex h-full flex-col bg-surface-base">
      <div className="scroll-quiet min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-[22px] pb-[calc(96px+env(safe-area-inset-bottom))]">
        {children}
      </div>

      <TabBar />
      <PushPrompt />
    </div>
  );
}
