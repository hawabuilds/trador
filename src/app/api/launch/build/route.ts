import {asPubkey} from "@/lib/pubkey";
import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {MetadataRejected, uploadLaunchMetadata} from "@/lib/server/launchMetadata";
import {LaunchRefused, buildStonkfunLaunch} from "@/lib/server/live/launchBuild";
import {stockForTicker} from "@/lib/stocks/registry";

export const dynamic = "force-dynamic";
// Hosting the image, reading the stock's launch settings and simulating can
// take a few seconds on a cold start.
export const maxDuration = 60;

/**
 * Build a StonkFun launch for the caller to sign.
 *
 * Signed-in only — this hosts an image — but the transaction it returns is
 * inert until the creator signs it, so nothing here can spend anyone's SOL.
 * The response is either a transaction that has already simulated cleanly on
 * mainnet, or a sentence saying why not.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const name = text(body.name);
  const symbol = text(body.symbol).replace(/^\$/, "").toUpperCase();
  const description = text(body.description).slice(0, 280);
  const creator = asPubkey(text(body.creator));
  const stock = stockForTicker(text(body.quoteTicker));
  const feeBps = Number(body.feeBps ?? 100);

  // Token metadata limits: a name longer than 32 bytes or a symbol longer than
  // 10 is rejected by the metadata program after the fee is paid.
  if (!name || Buffer.byteLength(name) > 32) return badRequest("Give it a name, 32 characters at most.");
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return badRequest("The ticker is 1–10 letters or numbers.");
  if (!creator) return badRequest("No wallet to launch from.");
  if (!stock) return badRequest("Pick a stock to price it in.");

  try {
    const {uri, image} = await uploadLaunchMetadata({
      name,
      symbol,
      description,
      imageDataUrl: text(body.image),
      links: {
        twitter: text(body.twitter) || undefined,
        telegram: text(body.telegram) || undefined,
        website: text(body.website) || undefined,
      },
    });

    const launch = await buildStonkfunLaunch({creator, name, symbol, uri, stock, feeBps});
    return json({...launch, image, quoteTicker: stock.ticker});
  } catch (error) {
    if (error instanceof LaunchRefused || error instanceof MetadataRejected) {
      return json({error: error.message}, {status: 422});
    }
    return json({error: `Could not prepare the launch: ${(error as Error).message}`}, {status: 503});
  }
}
