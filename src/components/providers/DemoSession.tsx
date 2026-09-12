"use client";

import {useCallback, useMemo, useState} from "react";

import {SessionContext, type Session} from "@/lib/session";
import {assertPubkey} from "@/lib/pubkey";

/**
 * A faked session, used when no Privy app id is configured.
 *
 * The point is that a fresh checkout is fully explorable without credentials —
 * the feed, the charts, the watchlist and the Stonkfolio all work. What it will
 * not do is pretend to sign: `signAndSend` is null, so every trade and launch
 * path is disabled rather than silently producing a fake success. A demo mode
 * that fakes a fill is worse than one that admits it cannot trade.
 */
const DEMO_WALLET = assertPubkey(
  "5CEbueQnq1Ym2uSSx2xXds3jQAqT1BDnkA59RZobSPAG",
  "demo wallet",
);

export function DemoSessionProvider({children}: {children: React.ReactNode}) {
  const [authenticated, setAuthenticated] = useState(true);

  const login = useCallback(() => setAuthenticated(true), []);
  const logout = useCallback(() => setAuthenticated(false), []);

  const session = useMemo<Session>(
    () => ({
      ready: true,
      authenticated,
      mode: "demo",
      user: authenticated
        ? {
            id: "demo",
            handle: "demo",
            displayName: "Demo",
            pfpUrl: null,
            wallet: DEMO_WALLET,
          }
        : null,
      login,
      logout,
      // Deliberately null. See the note above.
      signAndSend: null,
      getAccessToken: async () => null,
    }),
    [authenticated, login, logout],
  );

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
