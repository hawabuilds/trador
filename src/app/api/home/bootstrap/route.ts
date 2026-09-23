import {publicJson} from "@/lib/server/http";
import {fetchFeed} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

const BOOTSTRAP_SORTS = ["trending", "new", "marketCap"] as const;

/** Edge-cacheable home seed — stonks for the requested sort, no stocks or graduating. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("sort");
  const sort =
    raw && (BOOTSTRAP_SORTS as readonly string[]).includes(raw)
      ? (raw as (typeof BOOTSTRAP_SORTS)[number])
      : "trending";
  const feed = await fetchFeed(sort, {limit: 40});
  return publicJson(
    {
      at: Date.now(),
      stonks: feed,
      sort,
    },
    15,
  );
}
