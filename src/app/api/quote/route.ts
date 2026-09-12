import {badRequest, json} from "@/lib/server/http";
import {asPubkey} from "@/lib/pubkey";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {FEE_WALLET, quote} from "@/lib/server/live/jupiter";

export const dynamic = "force-dynamic";

/**
 * Price a trade.
 *
 * The client sends mints and an amount in base units; nothing about routing or
 * fees is decided here beyond passing the platform fee, so a change to either
 * is a server change rather than a client release.
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
    const priced = await quote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      // A fee is only priced when there is somewhere for it to go.
      feeAccount: FEE_WALLET,
    });

    return json({
      quote: priced,
      // Told to the client rather than inferred there, so the ticket cannot
      // claim a fee that was never priced in.
      feeCharged: priced.platformFee !== null,
      nativeMint: WSOL_MINT,
      stableMint: USDC_MINT,
    });
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
