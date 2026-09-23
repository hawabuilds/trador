"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useQuery} from "@tanstack/react-query";
import type {QueryKey} from "@tanstack/react-query";

import type {FeedPage, Stock, Stonk, StonkSort} from "@/lib/types";

type FeedStonkSort = Exclude<StonkSort, "graduating">;

function feedPlaceholderData(
  previousData: FeedResponse | undefined,
  previousQuery: {queryKey: QueryKey} | undefined,
  apiSort: FeedStonkSort,
): FeedResponse | undefined {
  if (!previousData || !previousQuery) return undefined;
  // Quote and include toggles keep the last page visible; a sort change must not
  // reuse another order's rows — Trending coins under New read as a broken feed.
  if (previousQuery.queryKey[1] !== apiSort) return undefined;
  return previousData;
}

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
  initialStonkSort,
  seedGraduating,
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
  /** Which stonks sort the server seed was fetched for — not Graduating. */
  initialStonkSort: FeedStonkSort;
  /** True when SSR already fetched the graduating list for first paint. */
  seedGraduating: boolean;
  /** False when Home is kept alive but hidden on another tab. */
  enabled?: boolean;
}) {
  const apiSort = sort === "graduating" ? "trending" : sort;

  const plainPoll = !quoteTicker && !include.stocks && !include.graduating;
  const stonksSeedMatches =
    plainPoll &&
    sort !== "graduating" &&
    sort === apiSort &&
    sort === initialStonkSort;
  const graduatingSeedMatches =
    !quoteTicker &&
    !include.stocks &&
    include.graduating &&
    sort === "graduating" &&
    seedGraduating;

  const stonksSortAwaitingFetch =
    sort !== "graduating" &&
    sort === apiSort &&
    sort !== initialStonkSort &&
    (sort === "new" || sort === "marketCap");

  const emptyStonks: FeedPage<Stonk> = {
    items: [],
    cursor: null,
    source: initial.stonks.source,
    capturedAt: initial.stonks.capturedAt,
  };

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
      stonksSeedMatches || graduatingSeedMatches
        ? {
            stonks: stonksSeedMatches ? initial.stonks : emptyStonks,
            stocks: null,
            graduating: graduatingSeedMatches ? [...(initial.graduating ?? [])] : null,
          }
        : undefined,
    placeholderData: (previousData, previousQuery) =>
      feedPlaceholderData(previousData, previousQuery, apiSort),
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });

  const firstPage = query.data?.stonks ?? (stonksSeedMatches ? initial.stonks : emptyStonks);

  const stocks = query.data?.stocks ?? initial.stocks;

  const graduatingFromQuery = query.data?.graduating;
  const graduating: readonly Stonk[] | null =
    graduatingFromQuery !== undefined && graduatingFromQuery !== null
      ? graduatingFromQuery
      : graduatingSeedMatches
        ? [...(initial.graduating ?? [])]
        : include.graduating
          ? null
          : [...(initial.graduating ?? [])];

  const graduatingLoading =
    include.graduating &&
    graduating === null &&
    (query.isPending || query.isFetching || !graduatingSeedMatches);

  const stonksLoading =
    stonksSortAwaitingFetch &&
    !stonksSeedMatches &&
    (query.isPending || (query.isFetching && !query.data));

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
    graduatingLoading,
    stonksLoading,
    isFetching: query.isFetching,
    isPlaceholder: query.isPlaceholderData,
    error: query.error ? (query.error as Error).message : null,
    hasMore: Boolean(nextCursor),
    loadingMore,
    loadMore,
  };
}
