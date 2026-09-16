import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {balancesFor} from "@/lib/server/live/holdings";

export const dynamic = "force-dynamic";

/** A ticket needs its asset and the funding token — never a whole portfolio. */
const MAX_MINTS = 4;

/**
 * What a wallet holds of a few mints, in exact base units.
 *
 * The order ticket reads this so it can offer "sell all", size 25/50/75% of a
 * real position, and refuse an amount the wallet cannot cover before the user
 * is asked to sign it.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const wallet = asPubkey(params.get("wallet"));
  if (!wallet) return badRequest("A base58 wallet address is required.");

  const raw = (params.get("mints") ?? "").split(",").filter(Boolean);
  if (raw.length > MAX_MINTS) return badRequest(`At most ${MAX_MINTS} mints.`);

  const mints: Pubkey[] = [];
  for (const value of raw) {
    const mint = asPubkey(value);
    if (!mint) return badRequest("Every mint must be base58.");
    if (!mints.includes(mint)) mints.push(mint);
  }

  try {
    return json(await balancesFor(wallet, mints));
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
