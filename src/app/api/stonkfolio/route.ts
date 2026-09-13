import {asPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {stonkfolioFor} from "@/lib/server/live/holdings";
import {recordSnapshot} from "@/lib/server/live/portfolioSnapshots";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = asPubkey(new URL(request.url).searchParams.get("wallet"));
  if (!wallet) return badRequest("A base58 wallet address is required.");

  try {
    const stonkfolio = await stonkfolioFor(wallet);

    /*
     * Sample the value on the way past.
     *
     * This is the only moment the app knows what a wallet is worth, so it is
     * the only place a growth chart can get a point. `recordSnapshot` rate
     * limits itself to one row per ten minutes and swallows its own failures,
     * so this cannot slow down or break the response it rides on.
     *
     * Not awaited for latency, but deliberately not fire-and-forget either:
     * the serverless runtime can freeze the moment the response is returned,
     * which kills a detached promise mid-write. Awaiting a guaranteed-resolving
     * call costs a few milliseconds and actually writes the row.
     *
     * Skipped when the read was served stale — a cached total would write a
     * fresh timestamp onto an old number and flatten the line.
     */
    if (!stonkfolio.stale) {
      await recordSnapshot(wallet, stonkfolio.totalUsd);
    }

    return json(stonkfolio);
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
