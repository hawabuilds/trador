import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {buildSwap, type SwapQuote} from "@/lib/server/live/jupiter";
import {resolvePlatformFeeAccount} from "@/lib/server/live/platformFee";

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
    const inputMint = asPubkey(body.quote.inputMint);
    const outputMint = asPubkey(body.quote.outputMint);
    if (!inputMint || !outputMint) return badRequest("Quote is missing mints.");

    const feeAccount = body.quote.platformFee
      ? await resolvePlatformFeeAccount({inputMint, outputMint})
      : null;
    if (body.quote.platformFee && !feeAccount) {
      return json(
        {
          error:
            "Platform fee was priced but the fee account is missing. Retry the quote, or fund the collector wSOL ATA.",
        },
        {status: 502},
      );
    }

    const built = await buildSwap({
      quote: body.quote,
      userPublicKey,
      feeAccount,
    });
    return json({swap: built});
  } catch (error) {
    // No transaction is ever returned alongside an error. Fail closed.
    return json({error: (error as Error).message}, {status: 502});
  }
}
