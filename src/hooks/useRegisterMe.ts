"use client";

import {useEffect, useRef} from "react";

import {clearReferral, readReferral} from "@/lib/referral";
import {useSession} from "@/lib/session";

/**
 * Make sure the signed-in person has a row.
 *
 * Without this the social layer is structurally empty: `follows` references
 * `users`, so nobody can be followed until they exist, and a profile link to a
 * real account would 404 forever. Signing in is the only moment the app knows
 * someone's handle and avatar, so it is the moment to write them down.
 *
 * Fire-and-forget, and deliberately silent. This is not something the person
 * asked for and there is nothing useful to tell them if it fails — the next
 * load tries again, and everything except follows works regardless.
 *
 * Runs once per session per handle. The ref guard matters because `AppShell`
 * re-renders on every navigation, and without it this would PUT on every tab
 * change for the entire session.
 */
export function useRegisterMe(): void {
  const session = useSession();
  const done = useRef<string | null>(null);

  const handle = session.user?.handle ?? null;
  const wallet = session.user?.wallet ?? null;

  useEffect(() => {
    if (!session.authenticated || !handle) return;

    /*
     * Keyed on handle *and* wallet.
     *
     * The wallet is created asynchronously by Privy and is usually null on the
     * first authenticated render, arriving a moment later. Keying on the handle
     * alone would record the row while it is still walletless and never go back
     * — so a profile would permanently show no wallet.
     */
    const key = `${handle}:${wallet ?? ""}`;
    if (done.current === key) return;
    done.current = key;

    void (async () => {
      try {
        const token = await session.getAccessToken();
        if (!token) return;

        // Whose shared link brought them here. The server only applies it if
        // this call is what creates the account, so sending it is always safe.
        const referredBy = readReferral();

        const response = await fetch("/api/me", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            handle,
            displayName: session.user?.displayName ?? null,
            pfpUrl: session.user?.pfpUrl ?? null,
            wallet,
            referredBy,
          }),
        });
        if (response.ok && referredBy) clearReferral();
      } catch {
        // Silent by design. See the note above.
      }
    })();
  }, [session, handle, wallet]);
}
