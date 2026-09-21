import {optionalCaller} from "@/lib/server/auth";
import {json} from "@/lib/server/http";
import {isAdmin} from "@/lib/server/referrals";

export const dynamic = "force-dynamic";

/** Whether the caller is the admin, so the UI knows to show the Referrals row. */
export async function GET(request: Request) {
  const caller = await optionalCaller(request);
  return json({admin: isAdmin(caller?.userId)});
}
