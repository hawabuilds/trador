import {json} from "@/lib/server/http";
import {cronAuthorized, cronRefused} from "@/lib/server/cron";
import {hasDatabase} from "@/lib/server/db";
import {indexAll} from "@/lib/server/live/launchIndexer";
import {readIndexerState} from "@/lib/server/live/universeStore";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The indexer, on a schedule.
 *
 * The same pass the Railway worker runs, exposed so the app can index without a
 * worker at all — a Vercel cron alone is enough to keep the feed current, just
 * with coarser latency.
 *
 * If a worker *is* running, this defers to it. Two reconcilers racing costs
 * double the RPC for no benefit, and the heartbeat is how that is detected
 * rather than assumed.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return cronRefused();
  if (!hasDatabase) return json({skipped: "no database configured"});

  const tip = await readIndexerState("live-tip");
  if (tip?.heartbeat_at) {
    const ageMs = Date.now() - Date.parse(tip.heartbeat_at);
    if (ageMs < 5 * 60_000) {
      return json({
        skipped: "a worker is alive",
        heartbeatAgeSeconds: Math.round(ageMs / 1000),
      });
    }
  }

  const result = await indexAll();
  return json(result);
}
