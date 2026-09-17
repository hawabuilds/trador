import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {
  deleteSubscription,
  pushConfigured,
  saveSubscription,
  sendWebPush,
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
    /** Send one notification straight back, to prove it arrived. */
    test?: boolean;
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

    /*
     * One notification back, immediately.
     *
     * Turning notifications on is otherwise an act of faith: the switch flips
     * and nothing happens until some future event, so there is no way to tell a
     * working subscription from one that silently failed at the push service.
     * This makes the first one arrive while the person is still looking at the
     * screen — and if it does not, they learn that now rather than by missing
     * something later.
     *
     * A failure here is not a failed subscription. The row is already saved, so
     * the count is reported and the request still succeeds.
     */
    let sent = 0;
    if (body.test) {
      try {
        ({sent} = await sendWebPush(caller.userId, {
          title: "Notifications are on",
          body: "You will hear about graduations, replies and coins you hold.",
          url: "/home",
        }));
      } catch {
        // Reported as zero below.
      }
    }

    return json({ok: true, sent});
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
