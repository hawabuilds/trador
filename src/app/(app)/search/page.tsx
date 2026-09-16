import {snapshotStocks} from "@/lib/server/snapshot";
import {fetchFeed} from "@/lib/server/sources";

import {SearchScreen} from "./SearchScreen";

export const metadata = {title: "Search"};

/**
 * Rendered per request, for the sake of the empty state.
 *
 * An empty search tab is a dead end: a box, a blinking cursor, and no signal
 * about what is in here or what the box will accept. So it opens on a handful
 * of real rows — the biggest stocks and the coins moving most — which double as
 * the answer to "what can I even search for".
 *
 * Fetched on the server rather than from a client effect so those rows are in
 * the first paint. They are a preview, not a feed, and a preview that arrives a
 * beat after the screen does is a layout shift on the tab people open most.
 *
 * `force-dynamic` for the same reason the home page needs it: the default would
 * bake these rows in at build time and serve them forever.
 */
export const dynamic = "force-dynamic";

/** How many of each to show. Enough to suggest the shape, short of a feed. */
const PREVIEW = 4;

export default async function SearchPage() {
  // Falls back to the bundled snapshot when the store is unreachable, so the
  // preview degrades to slightly stale rows rather than to an empty screen.
  const trending = await fetchFeed("trending", {limit: PREVIEW});

  return (
    <SearchScreen
      preview={[...snapshotStocks().items.slice(0, PREVIEW), ...trending.items.slice(0, PREVIEW)]}
    />
  );
}
