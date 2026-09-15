/**
 * Web push delivery.
 *
 * Degrades to a no-op rather than an error when VAPID keys are absent, because
 * a deployment without them is a perfectly valid deployment — everything except
 * the buzz still works — and throwing here would take down whatever pass was
 * calling it.
 */

import {appOrigin} from "@/lib/routes";
import {hasAdminPg, withClient} from "@/lib/server/adminPg";

export interface PushPayload {
  title: string;
  body: string;
  /** Where tapping it lands. Always a path in this app, never an outside link. */
  url: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function vapidPublicKey(): string {
  return (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    ""
  ).trim();
}

export function pushConfigured(): boolean {
  return Boolean(vapidPublicKey() && (process.env.VAPID_PRIVATE_KEY ?? "").trim());
}

export async function saveSubscription(
  userId: string,
  subscription: {endpoint: string; keys: {p256dh: string; auth: string}},
  userAgent: string | null,
): Promise<void> {
  if (!hasAdminPg) return;

  await withClient((client) =>
    client.query(
      `insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
       values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent`,
      [
        subscription.endpoint,
        userId,
        subscription.keys.p256dh,
        subscription.keys.auth,
        userAgent,
      ],
    ),
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  if (!hasAdminPg) return;
  await withClient((client) =>
    client.query("delete from public.push_subscriptions where endpoint = $1", [endpoint]),
  );
}

async function subscriptionsFor(userId: string): Promise<SubscriptionRow[]> {
  if (!hasAdminPg) return [];
  return withClient(async (client) => {
    const {rows} = await client.query(
      "select endpoint, p256dh, auth from public.push_subscriptions where user_id = $1",
      [userId],
    );
    return rows as SubscriptionRow[];
  });
}

/**
 * Send to every device a person has registered.
 *
 * A 404 or 410 means the browser threw the subscription away — the person
 * cleared site data, or the push service expired it — so the row is deleted
 * rather than retried. Anything else is logged and left alone: a transient
 * failure should not cost someone their subscription.
 */
export async function sendWebPush(
  userId: string,
  payload: PushPayload,
): Promise<{sent: number; gone: number}> {
  if (!pushConfigured()) return {sent: 0, gone: 0};

  const subscriptions = await subscriptionsFor(userId);
  if (subscriptions.length === 0) return {sent: 0, gone: 0};

  const webpush = await import("web-push");
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() ||
      `mailto:ops@${new URL(appOrigin()).hostname}`,
    vapidPublicKey(),
    (process.env.VAPID_PRIVATE_KEY ?? "").trim(),
  );

  const body = JSON.stringify(payload);
  let sent = 0;
  let gone = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {p256dh: subscription.p256dh, auth: subscription.auth},
          },
          body,
          {TTL: 86_400, urgency: "high"},
        );
        sent += 1;
      } catch (error) {
        const status = (error as {statusCode?: number}).statusCode;
        if (status === 404 || status === 410) {
          gone += 1;
          await deleteSubscription(subscription.endpoint);
          return;
        }
        console.error("web push failed", {status: status ?? null});
      }
    }),
  );

  return {sent, gone};
}
