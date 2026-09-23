"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";

import type {FeedPage, Stock, Stonk, StonkSort} from "@/lib/types";

interface FeedResponse {
  stonks: FeedPage<Stonk>;
  stocks: FeedPage<Stock> | null;
  /** Launches still on the curve, nearest to graduating first. */
  graduating: Stonk[] | null;
}

export interface FeedInclude {
  /** Live-priced stock list — only when the Stocks tab is open. */
  stocks: boolean;
  /** Curve launches — only when the Graduating sort is selected. */
  graduating: boolean;
}

/**
 * The feed, kept current.
 *
 * Seeded with what the server rendered, then polled. `initialData` is what
 * makes this free on first paint — the list is already on screen from SSR, and
 * React Query adopts it rather than firing a request to fetch what it was just
 * handed.
 *
 * Polls request only `stonks` by default. `include` adds stocks or graduating
 * when those surfaces are visible, so a background refresh does not re-run
 * Jupiter pricing or the graduating index on every tick.
 */
export function useFeed({
  sort,
  quoteTicker,
  include,
  initial,
  enabled = true,
}: {
  sort: StonkSort;
  quoteTicker: string | null;
  include: FeedInclude;
  initial: {
    stonks: FeedPage<Stonk>;
    stocks: FeedPage<Stock>;
    graduating?: readonly Stonk[];
  };
  /** False when Home is kept alive but hidden on another tab. */
  enabled?: boolean;
}) {
  const apiSort = sort === "graduating" ? "trending" : sort;

  const query = useQuery({
    queryKey: ["feed", apiSort, quoteTicker ?? "all", include.stocks, include.graduating],
    enabled,
    queryFn: async (): Promise<FeedResponse> => {
      const params = new URLSearchParams({sort: apiSort});
      if (quoteTicker && quoteTicker !== "all") params.set("quote", quoteTicker);

      const parts: string[] = [];
      if (include.stocks) parts.push("stocks");
      if (include.graduating) parts.push("graduating");
      if (parts.length > 0) params.set("include", parts.join(","));

      const response = await fetch(`/api/feed?${params}`);
      if (!response.ok) throw new Error("Could not load the feed.");
      return (await response.json()) as FeedResponse;
    },
    initialData:
      apiSort === "trending" && !quoteTicker && !include.stocks && !include.graduating
        ? {
            stonks: initial.stonks,
            stocks: null,
            graduating: null,
          }
        : undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  const firstPage = query.data?.stonks ?? initial.stonks;

  const stocks = query.data?.stocks ?? initial.stocks;
  const graduating = query.data?.graduating ?? initial.graduating ?? [];

  const [older, setOlder] = useState<readonly Stonk[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const listKey = `${apiSort}|${quoteTicker ?? "all"}`;
  const lastKey = useRef(listKey);
  useEffect(() => {
    if (lastKey.current === listKey) return;
    lastKey.current = listKey;
    setOlder([]);
    setCursor(null);
  }, [listKey]);

  const nextCursor = older.length === 0 ? firstPage.cursor : cursor;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const params = new URLSearchParams({sort: apiSort, cursor: nextCursor});
      if (quoteTicker && quoteTicker !== "all") params.set("quote", quoteTicker);

      const response = await fetch(`/api/feed?${params}`);
      if (!response.ok) return;

      const body = (await response.json()) as FeedResponse;
      const key = lastKey.current;
      if (key !== `${apiSort}|${quoteTicker ?? "all"}`) return;

      setOlder((previous) => [...previous, ...body.stonks.items]);
      setCursor(body.stonks.cursor);
    } catch {
      // A failed page leaves the cursor untouched, so the next scroll retries
      // the same page rather than skipping it.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, apiSort, quoteTicker]);

  const items = useMemo<readonly Stonk[]>(() => {
    if (older.length === 0) return firstPage.items;

    const seen = new Set<string>();
    const merged: Stonk[] = [];
    for (const stonk of [...firstPage.items, ...older]) {
      if (seen.has(stonk.mint)) continue;
      seen.add(stonk.mint);
      merged.push(stonk);
    }
    return merged;
  }, [firstPage.items, older]);

  return {
    stonks: {...firstPage, items},
    stocks,
    graduating,
    isFetching: query.isFetching,
    isPlaceholder: query.isPlaceholderData,
    error: query.error ? (query.error as Error).message : null,
    hasMore: Boolean(nextCursor),
    loadingMore,
    loadMore,
  };
}
