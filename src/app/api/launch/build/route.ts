import {PublicKey} from "@solana/web3.js";

import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {MetadataRejected, uploadLaunchMetadata} from "@/lib/server/launchMetadata";
import {readLaunchForm} from "@/lib/server/launchRequest";
import {LaunchRefused, stockBalance} from "@/lib/server/live/launchAssemble";
import {buildLaunch} from "@/lib/server/live/launchPreview";

export const dynamic = "force-dynamic";
// Hosting the image, reading the launchpad's settings and simulating can take
// a few seconds on a cold start.
export const maxDuration = 60;

/**
 * Build a launch — on StonkFun or pump.fun — for the caller to sign.
 *
 * Signed-in only, since this hosts an image, but the transaction it returns is
 * inert until the creator signs it. The response is either a transaction that
 * has already simulated cleanly on mainnet, or a sentence saying why not.
 *
 * `devBuyStock` is how much of the stock the dev buy spends. It is checked
 * against what the wallet actually holds rather than trusted: when a swap went
 * first, this is the moment its stock has to have arrived.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const form = readLaunchForm(body);
  if (typeof form === "string") return badRequest(form);

  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  let devBuyStock = 0n;
  try {
    devBuyStock = BigInt(text(body.devBuyStock) || "0");
  } catch {
    return badRequest("That dev buy amount isn't a number.");
  }

  try {
    if (devBuyStock > 0n) {
      const held = await stockBalance(new PublicKey(form.creator), form.stock.mint);
      if (held < devBuyStock) {
        // The swap's stock is not visible yet; the client retries shortly.
        return json(
          {error: `Waiting for your ${form.stock.ticker} to arrive…`, retry: true},
          {status: 409},
        );
      }
    }

    const {uri, image} = await uploadLaunchMetadata({
      name: form.name,
      symbol: form.symbol,
      description: text(body.description).slice(0, 280),
      imageDataUrl: text(body.image),
      links: {
        twitter: text(body.twitter) || undefined,
        telegram: text(body.telegram) || undefined,
        website: text(body.website) || undefined,
      },
    });

    const launch = await buildLaunch({...form, uri, devBuyStock});
    return json({...launch, image, quoteTicker: form.stock.ticker, launchpad: form.launchpad});
  } catch (error) {
    if (error instanceof LaunchRefused || error instanceof MetadataRejected) {
      return json({error: error.message}, {status: 422});
    }
    return json({error: `Could not prepare the launch: ${(error as Error).message}`}, {status: 503});
  }
}
