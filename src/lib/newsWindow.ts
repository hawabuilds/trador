import {startOfLocalDay} from "@/lib/format";
import type {NewsTopic, NewsWindow} from "@/lib/types";

/**
 * React Query key prefix. Bump alongside wire or window changes so a stale
 * empty cache from a previous shape cannot stick.
 */
export const NEWS_FEED_QUERY_KEY = "news-feed-v1";

/**
 * The chips the News tab lands on.
 *
 * Both the page's initial state and any prefetch read these. Kept as constants
 * rather than literals at each site because the two drifted apart in the
 * predecessor app: the default chip moved to `latest` while the warm kept
 * fetching `24h`, priming a cache key the tab never read — so every open paid
 * the full wire build it was supposed to skip.
 */
export const NEWS_DEFAULT_WINDOW: NewsWindow = "latest";
export const NEWS_DEFAULT_TOPIC: NewsTopic = "all";

/**
 * Server lookback per chip.
 *
 * `latest` is a rolling 24h window — the default chip.
 *
 * The Today chip (`24h`) is a local calendar day. Fetch 48h and let the client
 * clip to midnight, so timezones ahead of UTC still overlap.
 */
export const NEWS_WINDOW_MS: Record<NewsWindow, number> = {
  latest: 24 * 3_600_000,
  "24h": 48 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: 365 * 24 * 3_600_000,
};

/**
 * Stories for the Today chip.
 *
 * Prefer this local calendar day. If that would empty the tab while the payload
 * still has stories — a timezone overlap, an unparseable stamp, a CDN copy that
 * only held last night — keep the payload, so Today never sticks on "Nothing in
 * this window" while data plainly exists.
 */
export function selectTodayStories<T extends {publishedAt: string}>(
  items: T[],
  now: number = Date.now(),
): T[] {
  if (items.length === 0) return items;
  const start = startOfLocalDay(now);
  const today = items.filter((item) => {
    const at = Date.parse(item.publishedAt);
    return !Number.isFinite(at) || at >= start;
  });
  return today.length > 0 ? today : items;
}
