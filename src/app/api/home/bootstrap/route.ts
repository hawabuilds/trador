import {publicJson} from "@/lib/server/http";
import {fetchFeed} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/** Edge-cacheable home seed — trending stonks only, no stocks or graduating. */
export async function GET() {
  const feed = await fetchFeed("trending", {limit: 40});
  return publicJson(
    {
      at: Date.now(),
      stonks: {
        items: feed.items,
        cursor: feed.cursor,
        source: feed.source,
        capturedAt: feed.capturedAt,
      },
    },
    15,
  );
}
