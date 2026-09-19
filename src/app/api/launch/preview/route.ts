import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {placeholderMetadataUri} from "@/lib/server/launchMetadata";
import {readLaunchForm} from "@/lib/server/launchRequest";
import type {Pubkey} from "@/lib/pubkey";
import {LaunchRefused, SOL_MINT} from "@/lib/server/live/launchAssemble";
import {jupTokens} from "@/lib/server/live/jupTokens";
import {previewLaunch} from "@/lib/server/live/launchPreview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The full bill for a launch, before anything is uploaded or signed.
 *
 * Every line is a mainnet simulation — see `launchPreview.ts`. Signed-in only,
 * because each call runs several simulations against a paid RPC.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const form = readLaunchForm((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof form === "string") return badRequest(form);

  try {
    const [preview, prices] = await Promise.all([
      previewLaunch({...form, uri: placeholderMetadataUri()}),
      // SOL in dollars, so the bill can say what it costs in money too. A
      // missing price leaves the dollar figures off rather than guessing.
      jupTokens([SOL_MINT as Pubkey]).catch(() => new Map()),
    ]);
    return json({...preview, solUsd: prices.get(SOL_MINT)?.usdPrice ?? null});
  } catch (error) {
    if (error instanceof LaunchRefused) return json({error: error.message}, {status: 422});
    return json({error: `Could not price this launch: ${(error as Error).message}`}, {status: 503});
  }
}
