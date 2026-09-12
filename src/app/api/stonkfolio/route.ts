import {asPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {stonkfolioFor} from "@/lib/server/live/holdings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = asPubkey(new URL(request.url).searchParams.get("wallet"));
  if (!wallet) return badRequest("A base58 wallet address is required.");

  try {
    return json(await stonkfolioFor(wallet));
  } catch (error) {
    return json({error: (error as Error).message}, {status: 502});
  }
}
