"use client";

import {useSession} from "@/lib/session";

/** The signed-in person as the UI needs them: identity plus their wallet. */
export function useUser() {
  const {ready, authenticated, user, login, logout, mode} = useSession();

  return {
    ready,
    authenticated,
    user,
    handle: user?.handle ?? null,
    displayName: user?.displayName ?? null,
    pfpUrl: user?.pfpUrl ?? null,
    wallet: user?.wallet ?? null,
    isDemo: mode === "demo",
    login,
    logout,
  };
}
