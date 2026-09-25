import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {
  buildSwap,
  isJupiterRateLimitError,
  quoteWithoutPlatformFee,
  type SwapQuote,
} from "@/lib/server/live/jupiter";
import {resolvePlatformFeeAccount} from "@/lib/server/live/platformFee";
import {simulateSwapTransaction} from "@/lib/server/live/simulateSwap";

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

    // Stale quote or collector not ready — strip fee from the agreed quote instead
    // of re-pricing (an extra Jupiter quote per confirm is what trips lite-tier 429s).
    let platformFeeStripped = false;
    if (swapQuote.platformFee && !feeAccount) {
      swapQuote = quoteWithoutPlatformFee(swapQuote);
      feeAccount = null;
      platformFeeStripped = true;
    }

    let built = await buildSwap({
      quote: swapQuote,
      userPublicKey,
      feeAccount,
    });

    let simulation = await simulateSwapTransaction(built.transactionBase64);

    if (!simulation.ok && feeAccount && swapQuote.platformFee) {
      swapQuote = quoteWithoutPlatformFee(swapQuote);
      feeAccount = null;
      platformFeeStripped = true;
      built = await buildSwap({
        quote: swapQuote,
        userPublicKey,
        feeAccount: null,
      });
      simulation = await simulateSwapTransaction(built.transactionBase64);
    }

    if (!simulation.ok) {
      return json(
        {
          error: simulation.message,
          simulationLogs: simulation.logs.slice(-20),
        },
        {status: 502},
      );
    }

    return json({
      swap: built,
      ...(platformFeeStripped ? {platformFeeStripped: true} : {}),
    });
  } catch (error) {
    // No transaction is ever returned alongside an error. Fail closed.
    const message = (error as Error).message;
    return json(
      {error: message},
      {status: isJupiterRateLimitError(message) ? 429 : 502},
    );
  }
}
