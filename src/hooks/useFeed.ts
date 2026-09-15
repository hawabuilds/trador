"use client";

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

  return {
    /*
     * Never empty while data exists.
     *
     * A failed poll keeps the last good page rather than blanking the feed: the
     * rows on screen were true a moment ago, and a network blip is not a reason
     * to tell someone the universe is empty.
     */
    stonks: query.data?.stonks ?? initial.stonks,
    stocks: query.data?.stocks ?? initial.stocks,
    graduating: query.data?.graduating ?? initial.graduating ?? [],
    isFetching: query.isFetching,
    error: query.error ? (query.error as Error).message : null,
  };
}
