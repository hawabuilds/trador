import {asPubkey} from "@/lib/pubkey";
import {json, unauthorized} from "@/lib/server/http";
import {followedPublicWallets} from "@/lib/server/live/followedWallets";
import {webhookSecret} from "@/lib/server/live/heliusWebhook";
import {syncWalletTrades} from "@/lib/server/live/walletTrades";

export const dynamic = "force-dynamic";

/** Wallets read per delivery. A swap touches a handful, never hundreds. */
const MAX_WALLETS = 10;

/**
 * Helius telling us a watched wallet traded.
 *
 * The body decides nothing but which wallets to look at. Everything shown in
 * the feed is then read from chain by `syncWalletTrades` — a public URL that
 * anyone can post to must never be the source of a number people trade on.
 *
 * Always answers 200 once the secret matches. A webhook that returns an error
 * gets retried, and a retry storm over one unparseable transaction would cost
 * more than the trade is worth.
 */
export async function POST(request: Request) {
  const secret = webhookSecret();
  if (!secret) return unauthorized("Webhooks are not configured here.");

  const offered = request.headers.get("authorization") ?? "";
  if (offered !== secret) return unauthorized("Not a delivery we recognise.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ok: true, synced: 0});
  }

  const touched = new Set<string>();
  for (const event of Array.isArray(body) ? body : [body]) {
    const record = event as {accountData?: {account?: string}[]; feePayer?: string};
    if (record.feePayer) touched.add(record.feePayer);
    for (const account of record.accountData ?? []) {
      if (account.account) touched.add(account.account);
    }
  }
  if (touched.size === 0) return json({ok: true, synced: 0});

  try {
    // Only wallets we actually watch, so a delivery naming someone else's
    // address cannot make us read it.
    const watched = await followedPublicWallets();
    const wallets = watched
      .map((entry) => entry.wallet)
      .filter((wallet) => touched.has(wallet))
      .slice(0, MAX_WALLETS);

    await Promise.all(
      wallets.map(async (wallet) => {
        const pubkey = asPubkey(wallet);
        if (!pubkey) return;
        try {
          await syncWalletTrades(pubkey);
        } catch {
          // One unreadable wallet does not fail the delivery; the next trade
          // on it, or the Stonkfolio opening, reads it again.
        }
      }),
    );

    return json({ok: true, synced: wallets.length});
  } catch {
    return json({ok: true, synced: 0});
  }
}
