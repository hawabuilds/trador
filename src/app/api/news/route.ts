import {publicJson} from "@/lib/server/http";
import {newsForStock} from "@/lib/server/live/news";
import {newsFeed} from "@/lib/server/newsfeed";
import {stockForTicker} from "@/lib/stocks/registry";
import {
  NEWS_DEFAULT_TOPIC,
  NEWS_DEFAULT_WINDOW,
} from "@/lib/newsWindow";
import {NEWS_TOPICS, NEWS_WINDOWS, type NewsTopic, type NewsWindow} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The news tab, or coverage for one stock when `ticker` is given.
 *
 * Cached at the edge for five minutes: headlines do not change faster than
 * that, and every provider behind this is a courtesy rather than an agreement.
 *
 * `window` and `topic` are validated against their own constant lists rather
 * than cast. They come straight off the query string, and they index into a
 * lookup — an unchecked value would be `undefined` milliseconds and a window
 * that silently returns everything.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = params.get("ticker");

  if (ticker) {
    const stock = stockForTicker(ticker);
    if (!stock) {
      return publicJson({items: [], reason: "Not a stock in Trador.", seeded: false}, 300);
    }
    const {items, reason} = await newsForStock(stock);
    return publicJson({items, reason, seeded: false}, 300);
  }

  const window = pick(params.get("window"), NEWS_WINDOWS, NEWS_DEFAULT_WINDOW);
  const topic = pick(params.get("topic"), NEWS_TOPICS, NEWS_DEFAULT_TOPIC);

  const {items, tickers} = await newsFeed(window, topic);
  return publicJson({items, tickers, builtAt: new Date().toISOString()}, 300);
}

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
