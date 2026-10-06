"use client";

import {useInfiniteQuery} from "@tanstack/react-query";

import {useSession} from "@/lib/session";
import type {FeedPage} from "@/lib/server/socialFeed";

export const SOCIAL_FEED_KEY = "social-feed";

export type FeedTab = "following" | "top" | "latest";

/**
 * One tab of the Feed, a page at a time.
 *
 * Signed in or not: the token only decides whether votes come back marked as
 * yours, so a visitor reads the same list without one.
 */
export function useSocialFeed(tab: FeedTab, options: {enabled?: boolean} = {}) {
  const session = useSession();

  const query = useInfiniteQuery({
    queryKey: [SOCIAL_FEED_KEY, tab],
    enabled: options.enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: async ({pageParam}): Promise<FeedPage> => {
      const token = await session.getAccessToken();
      const params = new URLSearchParams({tab});
      if (pageParam) params.set("cursor", pageParam);
      const response = await fetch(`/api/social/feed?${params}`, {
        headers: token ? {authorization: `Bearer ${token}`} : {},
      });
      const body = (await response.json()) as FeedPage & {error?: string};
      if (!response.ok) throw new Error(body.error ?? "Could not load the feed.");
      return body;
    },
    getNextPageParam: (last) => last.cursor,
    staleTime: 15_000,
  });

  return {
    items: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}
