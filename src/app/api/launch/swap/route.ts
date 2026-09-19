import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {readLaunchForm} from "@/lib/server/launchRequest";
import {LaunchRefused, devBuySwap} from "@/lib/server/live/launchAssemble";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The first of two signatures when a dev buy needs the stock: SOL into the
 * stock the coin is priced in. Simulated before it is returned.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const form = readLaunchForm((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof form === "string") return badRequest(form);
  if (form.devBuyLamports <= 0n) return badRequest("No dev buy to swap for.");

  try {
    const swap = await devBuySwap({
      creator: form.creator,
      stockMint: form.stock.mint,
      lamports: form.devBuyLamports,
    });
    return json({transaction: swap.transaction, stockMinOut: swap.stockMinOut.toString()});
  } catch (error) {
    if (error instanceof LaunchRefused) return json({error: error.message}, {status: 422});
    return json({error: `Could not route the dev buy: ${(error as Error).message}`}, {status: 503});
  }
}
