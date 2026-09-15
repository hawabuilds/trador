import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {
  deleteSubscription,
  pushConfigured,
  saveSubscription,
  vapidPublicKey,
} from "@/lib/server/notifications/push";

export const dynamic = "force-dynamic";

/** The public key a browser needs to subscribe, and whether push is on at all. */
export async function GET() {
  return json({configured: pushConfigured(), publicKey: vapidPublicKey() || null});
}

/**
 * Register this browser for push.
 *
 * The subscription is bound to the caller's verified id, never to one supplied
 * in the body — otherwise anyone could point someone else's notifications at
 * their own device, or worse, register a victim's device against their own
 * account and read what arrives.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => null)) as {
    endpoint?: string;
    keys?: {p256dh?: string; auth?: string};
  } | null;

  if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    return badRequest("A push subscription needs an endpoint and both keys.");
  }

  try {
    await saveSubscription(
      caller.userId,
      {endpoint: body.endpoint, keys: {p256dh: body.keys.p256dh, auth: body.keys.auth}},
      request.headers.get("user-agent"),
    );
    return json({ok: true});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}

/**
 * Unregister this browser.
 *
 * Authenticated like the write, so an endpoint someone found cannot be used to
 * silence a person they do not control.
 */
export async function DELETE(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) return badRequest("Which subscription?");

  await deleteSubscription(endpoint);
  return json({ok: true});
}
