/**
 * News for the companies behind the stocks people trade against.
 *
 * The point of coverage in this app is narrow and worth stating: a coin priced
 * in NVDAx moves partly because Nvidia moved, so the useful headline is about
 * Nvidia. Generic crypto news would be noise on every screen it appeared on.
 *
 * Yahoo's per-ticker RSS, because it needs no key. A fresh checkout gets real
 * coverage rather than a placeholder, which is the same standard the feed is
 * held to.
 *
 * Two honest limits, both surfaced rather than hidden:
 *   - A pre-IPO name has no ticker and no wire. There is no coverage to show
 *     and the UI says so instead of showing something adjacent.
 *   - A ticker that returns nothing is reported as "no coverage", not as an
 *     error — most often it is simply a quiet day.
 */

import type {NewsItem} from "@/lib/types";
import {STOCK_MINTS, type StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";

/**
 * The underlying ticker a tokenized stock tracks.
 *
 * Issuers append `x`, so stripping it is right for most of the range. The
 * exceptions are spelled out: a dotted class share is hyphenated by the wire,
 * and a few names have no public listing at all.
 */
const OVERRIDES: Record<string, string | null> = {
  "BRK.Bx": "BRK-B",
  // Not publicly listed, so there is no ticker and no wire.
  SPCXx: null,
};

export function underlyingTicker(stock: StockMint): string | null {
  if (stock.kind === "pre-ipo") return null;
  if (stock.ticker in OVERRIDES) return OVERRIDES[stock.ticker];
  return stock.ticker.endsWith("x") ? stock.ticker.slice(0, -1) : stock.ticker;
}

/** Minimal RSS reader — enough for one well-formed feed, and no dependency. */
function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];

  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const pick = (tag: string): string => {
      const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      if (!match) return "";
      return match[1]
        .replace(/^<!\[CDATA\[/, "")
        .replace(/\]\]>$/, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();
    };

    const title = pick("title");
    const url = pick("link");
    if (!title || !url) continue;

    const published = pick("pubDate");
    const at = new Date(published);

    items.push({
      id: pick("guid") || url,
      title,
      url,
      source,
      publishedAt: Number.isFinite(at.getTime()) ? at.toISOString() : new Date().toISOString(),
      summary: pick("description") || null,
      imageUrl: null,
    });
  }

  return items;
}

/**
 * Article artwork, from the page's own OpenGraph tags.
 *
 * The RSS feed carries no images, so the only way to get real ones is to look
 * at the article. That costs a fetch per story, so it is capped, cached for an
 * hour, and only the first few bytes of the response are read — the tags are in
 * `<head>`, and streaming a whole news page to find them would be absurd.
 *
 * A failure returns null and the card renders without an image. A placeholder
 * would be worse: a grey box that looks like a broken photo rather than an
 * article that simply has none.
 */
async function ogImage(url: string): Promise<string | null> {
  try {
    const {value} = await cached(`og:${url}`, 3_600_000, async () => {
      const response = await fetch(url, {
        headers: {"user-agent": "Mozilla/5.0 (compatible; Trador/0.1)"},
        signal: AbortSignal.timeout(4_000),
        cache: "no-store",
      });
      if (!response.ok || !response.body) return null;

      // Read only the head. 40KB is generous for it and bounded either way.
      const reader = response.body.getReader();
      let html = "";
      while (html.length < 40_000) {
        const {done, value: chunk} = await reader.read();
        if (done) break;
        html += new TextDecoder().decode(chunk);
        if (html.includes("</head>")) break;
      }
      void reader.cancel();

      const match =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ??
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);

      const image = match?.[1] ?? null;
      // Only absolute https — a relative path would need the article's base and
      // an http one is blocked on an https page anyway.
      return image && image.startsWith("https://") ? image : null;
    });

    return value;
  } catch {
    return null;
  }
}

/** Attach artwork to the first few stories, which is all anyone scrolls past. */
async function withImages(items: NewsItem[], cap = 12): Promise<NewsItem[]> {
  const head = items.slice(0, cap);
  const images = await Promise.all(head.map((item) => ogImage(item.url)));

  return items.map((item, index) =>
    index < cap ? {...item, imageUrl: images[index]} : item,
  );
}

async function feedFor(ticker: string): Promise<NewsItem[]> {
  const response = await fetch(
    `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}` +
      `&region=US&lang=en-US`,
    {
      // The wire refuses a bare fetch with no user agent.
      headers: {"user-agent": "Mozilla/5.0 (compatible; Trador/0.1)"},
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`News wire returned ${response.status}.`);
  return parseRss(await response.text(), ticker);
}

/** Coverage for one stock, keyed by its own ticker. */
export async function newsForStock(
  stock: StockMint,
): Promise<{items: NewsItem[]; reason: string | null}> {
  const ticker = underlyingTicker(stock);
  if (!ticker) {
    return {
      items: [],
      reason:
        `${stock.ticker} tracks a company that is not publicly listed, so there ` +
        `is no market coverage to show.`,
    };
  }

  try {
    const {value} = await cached(`news:${ticker}`, 300_000, () => feedFor(ticker));
    return {
      items: await withImages(value),
      reason: value.length === 0 ? `No recent coverage for ${ticker}.` : null,
    };
  } catch (error) {
    return {items: [], reason: (error as Error).message};
  }
}

/**
 * The news tab: coverage across the stocks the scene is actually trading in.
 *
 * Ranked by how many launches price against each stock rather than by market
 * cap, for the same reason the Stocks tab is — this app's signal is what people
 * here are trading, not what is largest.
 */
export async function newsWire(limit = 6): Promise<{items: NewsItem[]; tickers: string[]}> {
  const {value} = await cached(`news:wire:${limit}`, 300_000, async () => {
    const stocks = [...STOCK_MINTS]
      .filter((stock) => underlyingTicker(stock) !== null)
      .sort((a, b) => b.launchesQuotedAgainst - a.launchesQuotedAgainst)
      .slice(0, limit);

    const results = await Promise.all(
      stocks.map(async (stock) => {
        const ticker = underlyingTicker(stock)!;
        try {
          // Each ticker is cached separately, so the per-asset page and this
          // wire share one fetch rather than doubling provider load.
          const {value: items} = await cached(`news:${ticker}`, 300_000, () =>
            feedFor(ticker),
          );
          return items.slice(0, 6);
        } catch {
          // One dead ticker must not empty the wire.
          return [];
        }
      }),
    );

    const seen = new Set<string>();
    const items = results
      .flat()
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

    return {items: await withImages(items), tickers: stocks.map((stock) => stock.ticker)};
  });

  return value;
}
