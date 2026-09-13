/**
 * The news tab's feed: stories and posts, ranked together by time.
 *
 * Three sources, each answering a different question:
 *
 *   - **Tokenized stocks** — Yahoo's per-ticker RSS for the companies behind
 *     the stocks coins are actually quoted against. A coin priced in NVDAx
 *     moves partly because Nvidia moved, so that is the headline worth reading
 *     next to the chart.
 *   - **Solana** — the same wire, pointed at SOL. Coins here settle in SOL even
 *     when they are priced in a stock, so what SOL is doing is not off-topic.
 *   - **Socials** — what the accounts upstream of this universe actually
 *     posted. See `live/x.ts`.
 *
 * Ranked strictly by recency across all three. There is no editorial weighting,
 * because any weighting here would be this app deciding what matters about
 * companies it has no relationship with.
 */

import {newsWireItems, solanaWire} from "./live/news";
import {solanaPosts} from "./live/x";
import {NEWS_WINDOW_MS} from "@/lib/newsWindow";
import type {FeedItem, NewsTopic, NewsWindow} from "@/lib/types";

/**
 * Everything in one window, newest first.
 *
 * Each source is awaited independently and a failure yields an empty list
 * rather than rejecting: one dead provider must degrade the tab, never empty
 * it. That is the same rule the feed follows, and it is why this uses
 * `allSettled` semantics by construction rather than `Promise.all`.
 */
export async function newsFeed(
  window: NewsWindow,
  topic: NewsTopic,
): Promise<{items: FeedItem[]; tickers: string[]}> {
  const [stocks, solana, posts] = await Promise.all([
    newsWireItems().catch(() => ({items: [] as FeedItem[], tickers: [] as string[]})),
    solanaWire().catch(() => [] as FeedItem[]),
    solanaPosts().catch(() => [] as FeedItem[]),
  ]);

  const seen = new Set<string>();
  const matching = [...stocks.items, ...solana, ...posts]
    .filter((item) => {
      if (!matchesTopic(item, topic)) return false;
      // Two tickers can carry the same wire story; the first one wins.
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const cutoff = Date.now() - NEWS_WINDOW_MS[window];
  const inWindow = matching.filter((item) => {
    const at = Date.parse(item.publishedAt);
    // An unparseable stamp is kept rather than dropped. A story with a bad date
    // is still a story, and silently binning it looks like a gap in coverage
    // rather than a bad field.
    return !Number.isFinite(at) || at >= cutoff;
  });

  /*
   * If the window would empty a topic that plainly has stories, show the
   * newest few instead.
   *
   * Not every wire publishes daily. Yahoo's SOL feed goes quiet for days at a
   * time, so a 24h "Latest" chip renders the Solana section empty while
   * nineteen perfectly good stories sit just outside it — which reads as a
   * broken tab, not as a quiet week.
   *
   * This is the same rule `selectTodayStories` already applies to the Today
   * chip, for the same reason, and it is bounded the same way: it only fires
   * when the window is *completely* empty, so a window with even one story in
   * it still means exactly what it says.
   */
  const items = inWindow.length > 0 ? inWindow : matching.slice(0, 12);

  return {items, tickers: stocks.tickers};
}

function matchesTopic(item: FeedItem, topic: NewsTopic): boolean {
  if (topic === "all") {
    /*
     * Top stories is articles only.
     *
     * Posts still render — the page pulls them into their own rail — but they
     * are not mixed into the story list, because a two-line post between two
     * headlines reads as a story that failed to load its title.
     */
    return item.kind === "article";
  }
  if (topic === "posts") return item.kind === "account";
  return item.topic === topic;
}
