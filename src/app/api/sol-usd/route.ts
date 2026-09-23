import {json, privateCachedJson} from "@/lib/server/http";
import {WSOL_MINT} from "@/lib/programs";
import {jupTokens} from "@/lib/server/live/jupTokens";

export const dynamic = "force-dynamic";

/**
 * Spot SOL/USD for the order ticket.
 *
 * Jupiter's token API is the same source the launch bill uses. Cached briefly
 * so switching between USD and SOL sizing on one ticket does not hammer it.
 */
export async function GET() {
  try {
    const prices = await jupTokens([WSOL_MINT]);
    const usd = prices.get(WSOL_MINT)?.usdPrice ?? null;
    return privateCachedJson({usd}, 30);
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
