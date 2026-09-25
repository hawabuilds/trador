"use client";

import {useEffect, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";

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
 * Fire-and-forget, and deliberately silent in the UI. Failures must still be
 * retried: marking the attempt done before `/api/me` succeeds left people with
 * a Privy session (and a Share URL built from their X handle) but no `users`
 * row, so the link they handed out 404'd forever.
 *
 * Runs once per session per handle+wallet once it succeeds. The ref guard
 * matters because `AppShell` re-renders on every navigation, and without it
 * this would PUT on every tab change for the entire session.
 */
export function useRegisterMe(): void {
  const session = useSession();
  const queryClient = useQueryClient();
  const done = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const handle = session.user?.handle ?? null;
  const wallet = session.user?.wallet ?? null;
  const displayName = session.user?.displayName ?? null;
  const pfpUrl = session.user?.pfpUrl ?? null;
  const authenticated = session.authenticated;
  const getAccessToken = session.getAccessToken;

  useEffect(() => {
    if (!authenticated || !handle) return;

    /*
     * Keyed on handle *and* wallet.
     *
     * The wallet is created asynchronously by Privy and is usually null on the
     * first authenticated render, arriving a moment later. Keying on the handle
     * alone would record the row while it is still walletless and never go back
     * — so a profile would permanently show no wallet.
     */
    const key = `${handle}:${wallet ?? ""}`;
    if (done.current === key || inFlight.current === key) return;
    inFlight.current = key;

    let cancelled = false;

    void (async () => {
      // Token and the first PUT can both race the session. A few quiet retries
      // beat permanently skipping the insert after one early null token.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (cancelled) return;
        try {
          const token = await getAccessToken();
          if (!token) {
            await wait(400 * (attempt + 1));
            continue;
          }

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
              displayName,
              pfpUrl,
              wallet,
              referredBy,
            }),
          });
          if (!response.ok) {
            await wait(400 * (attempt + 1));
            continue;
          }

          if (referredBy) clearReferral();
          done.current = key;
          // Share is gated on the server profile existing; refresh so it appears.
          await queryClient.invalidateQueries({queryKey: ["profile", handle]});
          return;
        } catch {
          await wait(400 * (attempt + 1));
        }
      }
    })().finally(() => {
      if (inFlight.current === key) inFlight.current = null;
    });

    return () => {
      cancelled = true;
    };
  }, [authenticated, handle, wallet, displayName, pfpUrl, getAccessToken, queryClient]);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
