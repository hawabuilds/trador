/**
 * The Helius webhook that tells us a followed wallet traded.
 *
 * It carries no data we trust. The body is used for one thing — which
 * addresses moved — and the trades themselves are then read, parsed and
 * stored by `syncWalletTrades`, the same path the Stonkfolio uses. A webhook
 * is a stranger posting to a public URL; money in the feed should never come
 * from one.
 *
 * One webhook holds every watched address rather than one each: Helius counts
 * webhooks, not addresses, and a thousand of them would be a thousand things
 * to keep in step.
 */

import type {Pubkey} from "@/lib/pubkey";

const API = "https://api.helius.xyz/v0/webhooks";

/** Set on the webhook and checked on every delivery. */
export const webhookSecret = (): string | null =>
  process.env.HELIUS_WEBHOOK_SECRET?.trim() || null;

/** Where Helius should post. A stable URL, not a per-deploy preview one. */
export const webhookUrl = (): string | null => {
  const base = process.env.TRADOR_WEBHOOK_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/api/webhooks/helius` : null;
};

const apiKey = () => process.env.HELIUS_API_KEY?.trim() || null;

interface Webhook {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
}

async function listWebhooks(key: string): Promise<Webhook[]> {
  const response = await fetch(`${API}?api-key=${key}`);
  if (!response.ok) throw new Error(`Helius webhooks returned ${response.status}.`);
  const body = (await response.json()) as Webhook[];
  return Array.isArray(body) ? body : [];
}

export interface WebhookSync {
  status: "created" | "updated" | "unchanged" | "skipped";
  webhookId: string | null;
  addresses: number;
  reason?: string;
}

/**
 * Point one webhook at exactly the wallets we watch.
 *
 * Ours is recognised by its URL, so a webhook someone made by hand for
 * something else is left alone.
 */
export async function syncTradeWebhook(addresses: readonly Pubkey[]): Promise<WebhookSync> {
  const key = apiKey();
  const url = webhookUrl();
  const secret = webhookSecret();

  if (!key) return {status: "skipped", webhookId: null, addresses: 0, reason: "No HELIUS_API_KEY."};
  if (!url) {
    return {status: "skipped", webhookId: null, addresses: 0, reason: "No webhook URL configured."};
  }
  if (!secret) {
    return {
      status: "skipped",
      webhookId: null,
      addresses: 0,
      reason: "No HELIUS_WEBHOOK_SECRET, so deliveries could not be trusted.",
    };
  }

  const wanted = [...new Set(addresses.map(String))].sort();
  const mine = (await listWebhooks(key)).find((hook) => hook.webhookURL === url) ?? null;

  const body = {
    webhookURL: url,
    transactionTypes: ["SWAP"],
    accountAddresses: wanted,
    webhookType: "enhanced",
    authHeader: secret,
  };

  if (!mine) {
    // Nothing to watch yet and nothing registered: leave Helius alone.
    if (wanted.length === 0) {
      return {status: "skipped", webhookId: null, addresses: 0, reason: "No wallets to watch."};
    }
    const response = await fetch(`${API}?api-key=${key}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Creating the webhook returned ${response.status}.`);
    }
    const created = (await response.json()) as Webhook;
    return {status: "created", webhookId: created.webhookID, addresses: wanted.length};
  }

  const held = [...new Set(mine.accountAddresses ?? [])].sort();
  if (held.length === wanted.length && held.every((address, index) => address === wanted[index])) {
    return {status: "unchanged", webhookId: mine.webhookID, addresses: held.length};
  }

  const response = await fetch(`${API}/${mine.webhookID}?api-key=${key}`, {
    method: "PUT",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Updating the webhook returned ${response.status}.`);
  return {status: "updated", webhookId: mine.webhookID, addresses: wanted.length};
}
