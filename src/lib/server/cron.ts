/**
 * Cron authentication.
 *
 * A bearer secret rather than an IP allowlist or a header Vercel sets: these
 * routes write to the store and cost RPC calls, so an open one is both a data
 * integrity problem and a bill. Without `CRON_SECRET` set they refuse outright
 * rather than defaulting to open, because an accidentally public indexer is the
 * kind of mistake that is only noticed on an invoice.
 */

export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export function cronRefused(): Response {
  return new Response(
    JSON.stringify({
      error: process.env.CRON_SECRET
        ? "Unauthorized."
        : "CRON_SECRET is not set, so this route is disabled.",
    }),
    {status: 401, headers: {"content-type": "application/json"}},
  );
}
