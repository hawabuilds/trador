import {publicJson} from "@/lib/server/http";
import {fetchFeed, fetchGraduating, fetchStocks} from "@/lib/server/sources";


export const dynamic = "force-dynamic";

/*
 * The sorts `fetchFeed` can order by.
 *
 * `graduating` is deliberately absent: it does not reorder the graduated feed,
 * it swaps in a different set entirely, and that set ships on every response as
 * `graduating`. Passing it through here would ask the store to sort listed
 * coins by a column only pending ones have.
 */
const SORTS = ["trending", "new", "marketCap", "rewards"] as const;
type FeedSort = (typeof SORTS)[number];

/**
 * The feed, live.
 *
 * The home page renders its first paint on the server, which is what makes the
 * list appear before any provider is reachable. This is what keeps it moving
 * afterwards: the client polls here, so a coin launched thirty seconds ago
 * arrives without a reload.
 *
 * That gap was the whole bug. The page was server-rendering from the *static*
 * snapshot baked in at build time and never refetching, so the feed a visitor
 * saw was frozen at whenever the last deploy happened — while the worker
 * dutifully wrote new coins into a store nothing read.
 *
 * Cached for ten seconds at the edge. The worker sweeps every ninety, so
 * anything shorter is spend with nothing new to show, and anything longer is
 * visible lag on a feed whose whole point is being current.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const requested = params.get("sort");
  const sort: FeedSort = SORTS.includes(requested as FeedSort)
    ? (requested as FeedSort)
    : "trending";

  const quoteTicker = params.get("quote");
  const limit = Number(params.get("limit"));

  const stonks = await fetchFeed(sort, {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : undefined,
    cursor: params.get("cursor"),
    // "all" is the UI's word for no filter; the store wants null.
    quoteTicker: quoteTicker && quoteTicker !== "all" ? quoteTicker : null,
  });

  /*
   * Stocks come from the registry rather than the store.
   *
   * The set of verified tokenized equities changes when an issuer mints a new
   * one — a handful of times a year — and every entry carries a verified mint
   * authority that was checked by hand. Polling a database for it would add a
   * query per request to answer a question whose answer is in the bundle.
   */
  const stocks = await fetchStocks();

  /*
   * Launches still on the curve, nearest to graduating first.
   *
   * Sent with every feed response rather than behind its own endpoint, because
   * the tab strip switches between them instantly and a second round trip on
   * tap would make Graduating feel slower than the tabs either side of it.
   * It is 60 rows at most — the whole point of the 10% floor.
   */
  const graduating = await fetchGraduating();

  return publicJson({stonks, stocks, graduating}, 10);
}
