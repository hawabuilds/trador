import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {buildSwap, quote as priceQuote, type SwapQuote} from "@/lib/server/live/jupiter";
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

    let swapQuote: SwapQuote = body.quote;
    let feeAccount = swapQuote.platformFee
      ? await resolvePlatformFeeAccount({inputMint, outputMint})
      : null;

    // Stale quote or collector not ready — re-price without fee so Jupiter build
    // and simulation stay aligned (no platformFee in raw, no feeAccount).
    if (swapQuote.platformFee && !feeAccount) {
      const raw = swapQuote.raw as Record<string, unknown> | undefined;
      const amount = swapQuote.inAmount ?? String(raw?.inAmount ?? "");
      const slippageBps = swapQuote.slippageBps ?? Number(raw?.slippageBps ?? 100);
      if (!/^\d+$/.test(amount) || amount === "0") {
        return badRequest("Quote is missing input amount.");
      }
      swapQuote = await priceQuote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
        feeAccount: null,
      });
      feeAccount = null;
    }

    const built = await buildSwap({
      quote: swapQuote,
      userPublicKey,
      feeAccount,
    });
    return json({swap: built});
  } catch (error) {
    // No transaction is ever returned alongside an error. Fail closed.
    return json({error: (error as Error).message}, {status: 502});
  }
}
