"use client";

import {useEffect, useRef} from "react";
import type {QueryClient} from "@tanstack/react-query";

/** Which primary surface pull-to-refresh should update. */
export type PageRefreshScope = "home" | "search" | "asset" | "stonkfolio";

export function pageRefreshScope(pathname: string): PageRefreshScope | null {
  if (pathname === "/home" || pathname.startsWith("/home/")) return "home";
  if (pathname === "/search" || pathname.startsWith("/search/")) return "search";
  if (pathname.startsWith("/stonk/") || pathname.startsWith("/stock/")) return "asset";
  if (pathname === "/stonkfolio" || pathname.startsWith("/stonkfolio/")) return "stonkfolio";
  return null;
}

const handlers = new Map<PageRefreshScope, () => Promise<void>>();

/**
 * Register what "refresh" means for a kept-alive or routed screen.
 *
 * Home and Search stay mounted while other tabs are open, so a global
 * `refetchQueries({type: "active"})` would refresh the hidden feed from
 * Stonkfolio. Each surface registers its own work; the shell picks by pathname.
 */
export function usePageRefresh(scope: PageRefreshScope, refresh: () => Promise<void>): void {
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    const run = () => latest.current();
    handlers.set(scope, run);
    return () => {
      if (handlers.get(scope) === run) handlers.delete(scope);
    };
  }, [scope]);
}

export async function runPageRefresh(pathname: string, queryClient: QueryClient): Promise<void> {
  const scope = pageRefreshScope(pathname);
  if (scope) {
    const handler = handlers.get(scope);
    if (handler) {
      await handler();
      return;
    }
  }
  await queryClient.refetchQueries({type: "active"});
}
