import {feedStocksSnapshot, fetchFeed, fetchGraduating} from "@/lib/server/sources";
import type {StonkSort} from "@/lib/types";

import {HomeSeed} from "@/components/keptAlive/HomeSearchKeptAlive";

export const metadata = {title: "Home"};

/**
 * Rendered per request, from the live store.
 *
 * This used to read the *static* snapshot baked in at build time, which meant
 * the feed a visitor saw was frozen at whenever the last deploy happened —
 * while the worker dutifully wrote new coins into a store nothing read. The
 * universe grew and the app never showed it.
 *
 * `fetchFeed` keeps the property that made the snapshot attractive: it falls
 * back to the bundled rows when the store is unreachable or empty, so the list
 * still renders with no credentials and no network. The difference is that the
 * fallback is now the exception rather than the only path.
 *
 * `force-dynamic` because the default would statically render this at build
 * time and serve that HTML forever — the exact failure being fixed, just moved
 * one layer down. `HomeFeed` polls `/api/feed` from here on.
 *
 * `now` is passed down rather than read in the component so age strings are
 * identical on the server and after hydration.
 */
export const dynamic = "force-dynamic";

const emptyStocks = (): ReturnType<typeof feedStocksSnapshot> => ({
  items: [],
  cursor: null,
  source: "snapshot",
  capturedAt: null,
});

const STONK_SORTS = ["trending", "new", "graduating", "marketCap"] as const satisfies readonly StonkSort[];

function readStonkSort(raw: string | undefined): StonkSort {
  return raw && (STONK_SORTS as readonly string[]).includes(raw) ? (raw as StonkSort) : "trending";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: {tab?: string; sort?: string};
}) {
  /*
   * One store read for first paint, aligned with the sort in the URL when it is
   * not Graduating. Graduating loads its own list; other sorts still skip live
   * stock prices unless the Stocks tab is open.
   */
  const stonkSort = readStonkSort(searchParams.sort);
  const feedSort = stonkSort === "graduating" ? "trending" : stonkSort;
  const [feed, graduating] = await Promise.all([
    fetchFeed(feedSort),
    stonkSort === "graduating" ? fetchGraduating() : Promise.resolve([]),
  ]);
  const onStocksTab = searchParams.tab === "stocks";

  return (
    <HomeSeed
      stonks={feed}
      stocks={onStocksTab ? feedStocksSnapshot() : emptyStocks()}
      graduating={graduating}
      initialStonkSort={feedSort}
      seedGraduating={stonkSort === "graduating"}
      now={Date.now()}
    />
  );
}
