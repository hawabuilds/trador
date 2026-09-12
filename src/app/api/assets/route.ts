import {badRequest, json} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

/** How many a single request will resolve. The watchlist is the only caller. */
const MAX = 60;

/**
 * Resolve a batch of `kind:id` keys into assets.
 *
 * Used by the watchlist, which stores keys rather than rows so a starred coin
 * still shows live prices rather than whatever it cost when it was starred.
 *
 * A key that no longer resolves is dropped rather than failing the batch: a
 * coin can leave the universe, and one stale star should not empty the tab.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const keys = raw
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean)
    .slice(0, MAX);

  if (keys.length === 0) return json({assets: []});

  const resolved = await Promise.all(
    keys.map(async (key) => {
      // The id is everything after the first colon: a mint contains none, but
      // splitting on every colon would still be the wrong instinct to encode.
      const separator = key.indexOf(":");
      if (separator < 1) return null;

      const kind = key.slice(0, separator);
      const id = key.slice(separator + 1);
      if (kind !== "stonk" && kind !== "stock") return null;
      if (!id) return null;

      try {
        const {data} = await fetchAsset(kind, id);
        return data;
      } catch {
        return null;
      }
    }),
  );

  return json({assets: resolved.filter((asset) => asset !== null)});
}
