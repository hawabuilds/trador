import {requireCaller} from "@/lib/server/auth";
import {json, notFound} from "@/lib/server/http";
import {isAdmin, referralReport} from "@/lib/server/referrals";

export const dynamic = "force-dynamic";

/**
 * The full referral report. Admin only.
 *
 * Anyone else gets a 404 rather than a 403: a "forbidden" confirms there is
 * something here worth getting into.
 */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;
  if (!isAdmin(caller.userId)) return notFound();

  try {
    return json(await referralReport());
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
