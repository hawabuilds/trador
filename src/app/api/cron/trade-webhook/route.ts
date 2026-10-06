import {cronAuthorized, cronRefused} from "@/lib/server/cron";
import {hasDatabase} from "@/lib/server/db";
import {json} from "@/lib/server/http";
import {followedPublicWallets} from "@/lib/server/live/followedWallets";
import {syncTradeWebhook, webhookUrl} from "@/lib/server/live/heliusWebhook";

export const dynamic = "force-dynamic";

/**
 * Keep the trade webhook watching the right wallets.
 *
 * On a schedule rather than on every follow: registering with Helius is two
 * HTTP calls, and making somebody wait for them to tap Follow would be paying
 * for freshness nobody can see. A few minutes late is invisible — the trades
 * are read from chain when they arrive either way.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return cronRefused();
  if (!hasDatabase) return json({skipped: "no database configured"});

  try {
    const watched = await followedPublicWallets();
    const result = await syncTradeWebhook(watched.map((entry) => entry.wallet));
    return json({...result, url: webhookUrl()});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
