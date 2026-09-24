import {gpaDiscoveryLabel} from "@/lib/server/getProgramAccountsV2";
import {json} from "@/lib/server/http";
import {cronAuthorized, cronRefused} from "@/lib/server/cron";
import {hasDatabase} from "@/lib/server/db";
import {indexAll} from "@/lib/server/live/launchIndexer";
import {readIndexerState} from "@/lib/server/live/universeStore";
import {cronIndexerUsesSharedHelius, indexerRpcUrl, rpcUrlForLog} from "@/lib/server/rpcUrl";

let warnedCronSharedHelius = false;

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

  if (cronIndexerUsesSharedHelius() && !warnedCronSharedHelius) {
    warnedCronSharedHelius = true;
    console.warn(
      "Cron index on Vercel is using HELIUS_RPC_URL (no INDEXER_RPC_URL). Prefer a dedicated indexer key on Railway only; this route skips when the worker heartbeat is fresh.",
    );
  }

  const result = await indexAll();
  return json({
    ...result,
    discovery: gpaDiscoveryLabel(),
    indexerRpc: rpcUrlForLog(indexerRpcUrl()),
  });
}
