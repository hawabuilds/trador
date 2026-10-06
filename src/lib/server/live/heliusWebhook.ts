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

import {createHash} from "node:crypto";

import type {Pubkey} from "@/lib/pubkey";
import {useDirectPg, withClient} from "../adminPg";
import {db, hasDatabase} from "../db";

const API = "https://api.helius.xyz/v0/webhooks";

/** Set on the webhook and checked on every delivery. */
export const webhookSecret = (): string | null =>
  process.env.HELIUS_WEBHOOK_SECRET?.trim() || null;

/** Where Helius should post. A stable URL, not a per-deploy preview one. */
export const webhookUrl = (): string | null => {
  const base = process.env.TRADOR_WEBHOOK_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/api/webhooks/helius` : null;
};

/**
 * The key for Helius's own API, read from the RPC URL when it is not set
 * separately.
 *
 * Deliberately not `heliusKey()`: that one refuses to hand back a key shared
 * with the indexer, because the enhanced parse API on the indexer's key is
 * what rate-limits the launch sweeps. Registering a webhook is not that API
 * and costs the indexer nothing.
 */
function apiKey(): string | null {
  const direct = process.env.HELIUS_API_KEY?.trim();
  if (direct) return direct;
  const rpc = process.env.HELIUS_RPC_URL;
  if (!rpc) return null;
  try {
    return new URL(rpc).searchParams.get("api-key");
  } catch {
    return null;
  }
}

/** Where the applied address list is remembered between runs. */
const FINGERPRINT_KEY = "trade-webhook";

/** Helius refuses bursts on this API, so a call is retried before it is given up on. */
const RETRY_DELAYS_MS = [500, 2_000, 6_000];

const fingerprintOf = (addresses: readonly string[]) =>
  createHash("sha1").update(addresses.join(",")).digest("hex");

async function readFingerprint(): Promise<string | null> {
  try {
    if (useDirectPg) {
      const rows = await withClient(async (client) =>
        (
          await client.query<{cursor: string | null}>(
            "select cursor from public.batch_cursors where name = $1",
            [FINGERPRINT_KEY],
          )
        ).rows,
      );
      return rows[0]?.cursor ?? null;
    }
    if (!hasDatabase) return null;
    const {data} = await db()
      .from("batch_cursors")
      .select("cursor")
      .eq("name", FINGERPRINT_KEY)
      .maybeSingle();
    return (data?.cursor as string | null) ?? null;
  } catch {
    // Unreadable means "assume changed", which costs one Helius call.
    return null;
  }
}

async function writeFingerprint(value: string): Promise<void> {
  try {
    if (useDirectPg) {
      await withClient(async (client) => {
        await client.query(
          `insert into public.batch_cursors (name, cursor, updated_at)
           values ($1, $2, now())
           on conflict (name) do update set cursor = excluded.cursor, updated_at = now()`,
          [FINGERPRINT_KEY, value],
        );
      });
      return;
    }
    if (!hasDatabase) return;
    await db()
      .from("batch_cursors")
      .upsert({name: FINGERPRINT_KEY, cursor: value, updated_at: new Date().toISOString()});
  } catch (error) {
    // The next run simply calls Helius again.
    console.warn(`[trade-webhook] could not store the address fingerprint: ${String(error)}`);
  }
}

/**
 * One Helius call, retried.
 *
 * Their webhook API answers 429 to bursts, and from some hosts it answers 429
 * to everything for a while — which is why the worker, not a serverless
 * function, is what normally runs this. A failure here is logged and reported
 * rather than thrown away: a webhook stuck on yesterday's wallets is a feed
 * that quietly stops filling.
 */
async function heliusFetch(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    }
    const response = await fetch(url, init);
    if (response.ok || (response.status !== 429 && response.status < 500)) return response;
    last = response;
    console.warn(
      `[trade-webhook] Helius answered ${response.status} (attempt ${attempt + 1} of ${RETRY_DELAYS_MS.length + 1})`,
    );
  }
  return last as Response;
}

interface Webhook {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
}

async function listWebhooks(key: string): Promise<Webhook[]> {
  const response = await heliusFetch(`${API}?api-key=${key}`);
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
export async function syncTradeWebhook(
  addresses: readonly Pubkey[],
  options: {force?: boolean} = {},
): Promise<WebhookSync> {
  const key = apiKey();
  const url = webhookUrl();
  const secret = webhookSecret();

  if (!key) {
    return {status: "skipped", webhookId: null, addresses: 0, reason: "No Helius key."};
  }
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

  /*
   * Nothing to do unless the list moved. This is the difference between
   * calling Helius every few minutes forever and calling it when somebody
   * follows someone new, which is what their rate limit is for.
   */
  const fingerprint = fingerprintOf(wanted);
  if (!options.force && (await readFingerprint()) === fingerprint) {
    return {status: "unchanged", webhookId: null, addresses: wanted.length};
  }

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
    const response = await heliusFetch(`${API}?api-key=${key}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Creating the webhook returned ${response.status}.`);
    }
    const created = (await response.json()) as Webhook;
    await writeFingerprint(fingerprint);
    return {status: "created", webhookId: created.webhookID, addresses: wanted.length};
  }

  const held = [...new Set(mine.accountAddresses ?? [])].sort();
  if (held.length === wanted.length && held.every((address, index) => address === wanted[index])) {
    await writeFingerprint(fingerprint);
    return {status: "unchanged", webhookId: mine.webhookID, addresses: held.length};
  }

  const response = await heliusFetch(`${API}/${mine.webhookID}?api-key=${key}`, {
    method: "PUT",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Updating the webhook returned ${response.status}.`);
  await writeFingerprint(fingerprint);
  return {status: "updated", webhookId: mine.webhookID, addresses: wanted.length};
}
