import {requireCaller} from "@/lib/server/auth";
import {json, unauthorized} from "@/lib/server/http";
import {followedPublicWallets} from "@/lib/server/live/followedWallets";
import {syncTradeWebhook, webhookUrl} from "@/lib/server/live/heliusWebhook";
import {isAdmin} from "@/lib/server/referrals";

export const dynamic = "force-dynamic";

/**
 * Point the trade webhook at the wallets we currently watch.
 *
 * Run by hand after a deployment moves, and on its own whenever a follow
 * changes. Admin only: it spends a Helius API call and decides what the feed
 * is able to see.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!isAdmin(caller.userId)) return unauthorized("Admins only.");

  try {
    const watched = await followedPublicWallets();
    const result = await syncTradeWebhook(watched.map((entry) => entry.wallet));
    return json({...result, url: webhookUrl()});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

/** What the webhook would be set to, without changing anything. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!isAdmin(caller.userId)) return unauthorized("Admins only.");

  const watched = await followedPublicWallets();
  return json({url: webhookUrl(), wallets: watched.length});
}
