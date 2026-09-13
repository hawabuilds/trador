"use client";

import {useQuery} from "@tanstack/react-query";

import {NEWS_FEED_QUERY_KEY} from "@/lib/newsWindow";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";

interface FeedResponse {
  items: FeedItem[];
  tickers: string[];
  builtAt: string;
}

/**
 * The news tab's data.
 *
 * Keyed on window and topic so switching a chip is a cache hit the second time
 * rather than a refetch, and `placeholderData` keeps the previous page's
 * stories on screen while the next set loads — a news tab that blanks to a
 * skeleton on every chip press reads as broken even when it is fast.
 */
export function useNewsFeed(window: NewsWindow, topic: NewsTopic) {
  return useQuery({
    queryKey: [NEWS_FEED_QUERY_KEY, window, topic],
    queryFn: async (): Promise<FeedResponse> => {
      const response = await fetch(
        `/api/news?window=${window}&topic=${encodeURIComponent(topic)}`,
      );
      if (!response.ok) throw new Error("Could not load the news feed.");
      return (await response.json()) as FeedResponse;
    },
    staleTime: 300_000,
    placeholderData: (previous) => previous,
  });
}
