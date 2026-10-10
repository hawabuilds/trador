import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {isJupiterRateLimitError, quote} from "@/lib/server/live/jupiter";
import {
  feeAmountFor,
  feeTokenFace,
  resolveTradeFee,
} from "@/lib/server/live/platformFee";

export const dynamic = "force-dynamic";

/**
 * Price a trade.
 *
 * The client sends mints and an amount in base units; nothing about routing or
 * fees is decided here beyond passing the platform fee, so a change to either
 * is a server change rather than a client release.
 *
 * The fee is reported, not implied. Only this side knows which leg it comes out
 * of, and the router's own figure is denominated in the output mint whichever
 * leg that is — so a browser working it out from the dollar value would print a
 * number that disagrees with the transaction on buys. The ticket shows what
 * comes back here and does no arithmetic of its own.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  const inputMint = asPubkey(url.searchParams.get("inputMint"));
  const outputMint = asPubkey(url.searchParams.get("outputMint"));
  const amount = url.searchParams.get("amount") ?? "";
  const slippageBps = Number(url.searchParams.get("slippageBps") ?? 100);

  if (!inputMint || !outputMint) return badRequest("Both mints must be base58.");
  if (!/^\d+$/.test(amount) || amount === "0") {
    return badRequest("Amount must be a positive integer in base units.");
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 1 || slippageBps > 5_000) {
    return badRequest("Slippage must be between 1 and 5000 bps.");
  }

  try {
    const tradeFee = await resolveTradeFee({inputMint, outputMint});
    const priced = await quote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      // A fee is only priced when there is an initialised account to receive it.
      feeAccount: tradeFee?.account ?? null,
      feeBps: tradeFee?.bps,
    });

    // Priced and charged have to agree. If the router declined to price a fee,
    // none is reported however the collector is configured.
    const charged = tradeFee !== null && priced.platformFee !== null;
    const feeAmount = charged
      ? feeAmountFor({
          fee: tradeFee,
          inAmount: priced.inAmount,
          quotedFeeAmount: priced.platformFee?.amount ?? null,
        })
      : null;

    return json({
      quote: priced,
      fee:
        charged && feeAmount !== null
          ? {
              amount: feeAmount,
              mint: tradeFee.mint,
              side: tradeFee.side,
              bps: tradeFee.bps,
              ...feeTokenFace(tradeFee.mint),
            }
          : null,
      nativeMint: WSOL_MINT,
      stableMint: USDC_MINT,
    });
  } catch (error) {
    const message = (error as Error).message;
    return json({error: message}, {status: isJupiterRateLimitError(message) ? 429 : 502});
  }
}
