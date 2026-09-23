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

const INCLUDES = ["stocks", "graduating"] as const;
type FeedInclude = (typeof INCLUDES)[number];

function parseInclude(raw: string | null): Set<FeedInclude> {
  const out = new Set<FeedInclude>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    if ((INCLUDES as readonly string[]).includes(part)) out.add(part as FeedInclude);
  }
  return out;
}

/**
 * The feed, live.
 *
 * The home page renders its first paint on the server, which is what makes the
 * list appear before any provider is reachable. This is what keeps it moving
 * afterwards: the client polls here, so a coin launched thirty seconds ago
 * arrives without a reload.
 *
 * `include` is optional: omit it on the default stonks poll so fifteen-second
 * refreshes do not re-price every stock and re-list every curve launch. The
 * client asks for `stocks` or `graduating` when someone opens those surfaces.
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
  const include = parseInclude(params.get("include"));

  const feedOptions = {
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : undefined,
    cursor: params.get("cursor"),
    quoteTicker: quoteTicker && quoteTicker !== "all" ? quoteTicker : null,
  };

  const stonks = await fetchFeed(sort, feedOptions);

  const [stocks, graduating] = await Promise.all([
    include.has("stocks") ? fetchStocks() : Promise.resolve(null),
    include.has("graduating") ? fetchGraduating() : Promise.resolve(null),
  ]);

  return publicJson({stonks, stocks, graduating}, 10);
}
