import {snapshotStocks, snapshotStonks} from "@/lib/server/snapshot";

import {HomeFeed} from "./HomeFeed";

export const metadata = {title: "Home"};

/**
 * The feed is read on the server and handed to the client component as props.
 *
 * Which is the store/decorate split in miniature: the rows exist before any
 * provider is reachable, so the list renders with no credentials and no
 * network. Live prices decorate rows that are already there; they never decide
 * whether a row exists.
 *
 * `now` is passed down rather than read in the component so age strings are
 * identical on the server and after hydration.
 */
export default function HomePage() {
  return (
    <HomeFeed
      stonks={snapshotStonks()}
      stocks={snapshotStocks()}
      now={Date.now()}
    />
  );
}
