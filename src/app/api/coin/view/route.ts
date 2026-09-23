import {publicJson} from "@/lib/server/http";
import {assertPubkey} from "@/lib/pubkey";
import {pgIncrementPageView, hasAdminPg} from "@/lib/server/adminPg";

export const dynamic = "force-dynamic";

/**
 * Records one coin page view for trending engagement weight.
 * Fire-and-forget from the client; failures are ignored.
 */
export async function POST(request: Request) {
  if (!hasAdminPg) return publicJson({ok: false}, 0);

  let mint: string | undefined;
  try {
    const body = (await request.json()) as {mint?: string};
    mint = body.mint;
  } catch {
    return publicJson({ok: false}, 0);
  }

  if (!mint) return publicJson({ok: false}, 0);
  assertPubkey(mint, "coin view mint");

  try {
    await pgIncrementPageView(mint);
  } catch {
    return publicJson({ok: false}, 0);
  }

  return publicJson({ok: true}, 0);
}
