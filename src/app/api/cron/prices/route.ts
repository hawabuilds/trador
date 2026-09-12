import {json} from "@/lib/server/http";
import {cronAuthorized, cronRefused} from "@/lib/server/cron";
import {hasDatabase} from "@/lib/server/db";
import {decorateStonks} from "@/lib/server/live/launchIndexer";
import {listStonks} from "@/lib/server/live/universeStore";
import type {Pubkey} from "@/lib/pubkey";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refresh prices without re-discovering the universe.
 *
 * Split from the indexer because the two have different natural cadences:
 * discovery only matters when a coin launches, while a price is stale in
 * seconds. Running them together would either under-price or over-sweep.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return cronRefused();
  if (!hasDatabase) return json({skipped: "no database configured"});

  const page = await listStonks({sort: "marketCap", limit: 100});
  const result = await decorateStonks(page.rows.map((row) => row.mint as Pubkey));

  return json({refreshed: page.rows.length, ...result});
}
