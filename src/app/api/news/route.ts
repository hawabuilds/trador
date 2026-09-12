import {publicJson} from "@/lib/server/http";
import {newsForStock, newsWire} from "@/lib/server/live/news";
import {stockForTicker} from "@/lib/stocks/registry";

export const dynamic = "force-dynamic";

/**
 * The wire, or coverage for one stock when `ticker` is given.
 *
 * Cached at the edge for five minutes: headlines do not change faster than
 * that, and the provider is a courtesy rather than an agreement.
 */
export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker");

  if (ticker) {
    const stock = stockForTicker(ticker);
    if (!stock) {
      return publicJson({items: [], reason: "Not a stock in Trador.", seeded: false}, 300);
    }
    const {items, reason} = await newsForStock(stock);
    return publicJson({items, reason, seeded: false}, 300);
  }

  const {items, tickers} = await newsWire();
  return publicJson({items, tickers, seeded: false}, 300);
}
