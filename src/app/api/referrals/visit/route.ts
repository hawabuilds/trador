import {badRequest, json} from "@/lib/server/http";
import {recordVisit} from "@/lib/server/referrals";

export const dynamic = "force-dynamic";

/**
 * Someone opened a shared profile link while signed out.
 *
 * Public, because the visitor has no account yet. It can only ever add one row
 * per visitor per referrer, so it cannot be used to inflate anyone's numbers
 * beyond clearing their own storage — and opens are a funnel metric, not what
 * a reward would be paid on.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {handle?: unknown; visitor?: unknown};
  const handle = typeof body.handle === "string" ? body.handle.replace(/^@/, "").trim() : "";
  const visitor = typeof body.visitor === "string" ? body.visitor.trim() : "";
  if (!handle || !visitor) return badRequest("Which link, and who opened it?");

  try {
    return json({recorded: await recordVisit(handle, visitor)});
  } catch {
    // An open that isn't counted is not worth an error on the sign-up page.
    return json({recorded: false});
  }
}
