import {snapshotStocks} from "@/lib/server/snapshot";
import {fetchFeed} from "@/lib/server/sources";

import {HomeFeed} from "./HomeFeed";

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

export default async function HomePage() {
  const feed = await fetchFeed("trending");

  return (
    <HomeFeed
      stonks={{
        items: feed.items,
        cursor: feed.cursor,
        source: feed.source,
        capturedAt: feed.capturedAt,
      }}
      stocks={snapshotStocks()}
      now={Date.now()}
    />
  );
}
