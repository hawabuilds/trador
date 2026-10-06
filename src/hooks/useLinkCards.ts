"use client";

import {useQuery} from "@tanstack/react-query";

import {type LinkCard, linksIn} from "@/lib/linkPreview";

/**
 * Cards for the links in one comment.
 *
 * Asked for only when the body actually has a link, so a thread of ordinary
 * comments makes no requests at all. The server resolves from the stored body,
 * so nothing here sends it a URL.
 *
 * An hour's stale time matches the server's cache: scrolling a thread twice
 * costs one request, and a failure leaves the comment exactly as it was.
 */
export function useLinkCards(commentId: string, body: string): LinkCard[] {
  const hasLinks = linksIn(body).length > 0;

  const {data} = useQuery({
    queryKey: ["link-cards", commentId],
    enabled: hasLinks,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    queryFn: async (): Promise<LinkCard[]> => {
      const response = await fetch(
        `/api/link-preview?comment=${encodeURIComponent(commentId)}`,
      );
      if (!response.ok) return [];
      const body = (await response.json()) as {cards?: LinkCard[]};
      return body.cards ?? [];
    },
  });

  return data ?? [];
}
