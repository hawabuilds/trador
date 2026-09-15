/**
 * Generate a VAPID key pair for web push.
 *
 * VAPID is how a push service knows a notification really came from this app.
 * The pair is generated once and lives in the environment from then on:
 * regenerating it invalidates every subscription anyone has made, because the
 * browser stored the public key when it subscribed and will reject pushes
 * signed by a different one.
 *
 *   npm run vapid
 */

import webpush from "web-push";

const {publicKey, privateKey} = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local, then to Vercel and Railway.

The public key is safe to expose — it ships to the browser by design. The
private key signs pushes and must stay server-side; anything holding it can
send notifications as this app.

Regenerating them later drops every existing subscription on the floor, so
generate once and keep them.

  NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
  VAPID_PRIVATE_KEY=${privateKey}
  VAPID_SUBJECT=mailto:you@example.com
`);
