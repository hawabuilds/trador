import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {FEE_WALLET, buildSwap, type SwapQuote} from "@/lib/server/live/jupiter";

export const dynamic = "force-dynamic";

/**
 * Turn a quote into a transaction for the browser to sign.
 *
 * The quote is passed back verbatim rather than re-priced: re-quoting here
 * would build a transaction for a different price than the one the user just
 * agreed to, which is the single worst thing an order ticket can do.
 */
export async function POST(request: Request) {
  let body: {quote?: SwapQuote; userPublicKey?: string};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON.");
  }

  const userPublicKey = asPubkey(body.userPublicKey);
  if (!userPublicKey) return badRequest("A base58 wallet address is required.");
  if (!body.quote?.raw) return badRequest("A quote is required.");

  try {
    const built = await buildSwap({
      quote: body.quote,
      userPublicKey,
      feeAccount: FEE_WALLET,
    });
    return json({swap: built});
  } catch (error) {
    // No transaction is ever returned alongside an error. Fail closed.
    return json({error: (error as Error).message}, {status: 502});
  }
}
