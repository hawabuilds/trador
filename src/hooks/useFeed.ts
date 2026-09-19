"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {keepPreviousData, useQuery} from "@tanstack/react-query";

import type {FeedPage, Stock, Stonk, StonkSort} from "@/lib/types";

interface FeedResponse {
  stonks: FeedPage<Stonk>;
  stocks: FeedPage<Stock>;
  /** Launches still on the curve, nearest to graduating first. */
  graduating: Stonk[];
}

/**
 * The feed, kept current.
 *
 * Seeded with what the server rendered, then polled. `initialData` is what
 * makes this free on first paint — the list is already on screen from SSR, and
 * React Query adopts it rather than firing a request to fetch what it was just
 * handed.
 *
 * Polling rather than streaming, deliberately. A websocket would be the right
 * tool for a tape where every tick matters; a launch feed gains a coin every
 * few minutes, and a subscription per visitor is a connection to hold, a
 * reconnect path to get right and a serverless runtime that will not hold it
 * anyway. `useArrivals` covers the one thing polling loses — a row appearing
 * between two frames with nothing to draw the eye — by animating exactly the
 * rows that are new.
 *
 * `refetchOnWindowFocus` matters more than the interval here: the common shape
 * is a tab left open for an hour and then looked at, and that should not show
 * an hour-old feed for fifteen seconds before catching up.
 *
 * ## Paging
 *
 * The first page polls; the pages after it do not. That split is the whole
 * design. Re-fetching every loaded page on a fifteen-second timer would mean a
 * request whose cost grows the further somebody scrolls, and rows reshuffling
 * under a thumb that is halfway down the list. The rows near the top are the
 * ones that change; the ones forty deep are history, and history does not need
 * a poll.
 *
 * The consequence is that an older page can go stale while it is on screen. For
 * a list ordered by when a coin graduated that is fine — its position cannot
 * change, only its price, and the price is restated the moment the coin is
 * opened.
 */
export function useFeed({
  sort,
  quoteTicker,
  initial,
}: {
  sort: StonkSort;
  quoteTicker: string | null;
  initial: Omit<FeedResponse, "graduating"> & {graduating?: Stonk[]};
}) {
  const query = useQuery({
    queryKey: ["feed", sort, quoteTicker ?? "all"],
    queryFn: async (): Promise<FeedResponse> => {
      const params = new URLSearchParams({sort});
      if (quoteTicker && quoteTicker !== "all") params.set("quote", quoteTicker);

      const response = await fetch(`/api/feed?${params}`);
      if (!response.ok) throw new Error("Could not load the feed.");
      return (await response.json()) as FeedResponse;
    },
    // Only the first view matches what the server rendered. A different sort or
    // quote filter has to be fetched, so seeding those would show the wrong
    // rows under the right chip.
    initialData: sort === "trending" && !quoteTicker ? initial : undefined,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  /*
   * Never empty while data exists.
   *
   * A failed poll keeps the last good page rather than blanking the feed: the
   * rows on screen were true a moment ago, and a network blip is not a reason
   * to tell someone the universe is empty.
   */
  const firstPage = query.data?.stonks ?? initial.stonks;

  const [older, setOlder] = useState<readonly Stonk[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /*
   * Everything loaded past the first page is dropped when the list changes.
   *
   * A different sort is a different ordering, so a cursor taken against the old
   * one points into a sequence that no longer exists — following it would
   * append rows from the middle of another list. Same for the quote filter,
   * which changes the set rather than the order.
   */
  const listKey = `${sort}|${quoteTicker ?? "all"}`;
  const lastKey = useRef(listKey);
  useEffect(() => {
    if (lastKey.current === listKey) return;
    lastKey.current = listKey;
    setOlder([]);
    setCursor(null);
  }, [listKey]);

  // Before anything extra is loaded the next page follows the polled first
  // page; afterwards it follows the last page actually fetched.
  const nextCursor = older.length === 0 ? firstPage.cursor : cursor;

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const params = new URLSearchParams({sort, cursor: nextCursor});
      if (quoteTicker && quoteTicker !== "all") params.set("quote", quoteTicker);

      const response = await fetch(`/api/feed?${params}`);
      if (!response.ok) return;

      const body = (await response.json()) as FeedResponse;
      const key = lastKey.current;
      // The sort could have changed while this was in flight; appending then
      // would splice one ordering into another.
      if (key !== `${sort}|${quoteTicker ?? "all"}`) return;

      setOlder((previous) => [...previous, ...body.stonks.items]);
      setCursor(body.stonks.cursor);
    } catch {
      // A failed page leaves the cursor untouched, so the next scroll retries
      // the same page rather than skipping it.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, sort, quoteTicker]);

  /*
   * One list, deduplicated by mint.
   *
   * The first page polls while the pages under it do not, so a coin that falls
   * out of the first page between two polls can also be sitting in an older
   * page — and React would then see two rows with the same key. First
   * occurrence wins, which is the polled copy and therefore the fresher one.
   */
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
    stocks: query.data?.stocks ?? initial.stocks,
    graduating: query.data?.graduating ?? initial.graduating ?? [],
    isFetching: query.isFetching,
    /**
     * The rows on screen belong to the *previous* sort or filter, kept so the
     * list does not blank while the new one loads. The screen must not present
     * them as the answer to the chip that is now selected.
     */
    isPlaceholder: query.isPlaceholderData,
    error: query.error ? (query.error as Error).message : null,
    /** Whether another page exists, and how to ask for it. */
    hasMore: Boolean(nextCursor),
    loadingMore,
    loadMore,
  };
}
