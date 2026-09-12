import {asPubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {planLaunch} from "@/lib/server/live/launch";
import {stockForTicker} from "@/lib/stocks/registry";

export const dynamic = "force-dynamic";

/**
 * Plan a launch and say exactly what it would do, without signing anything.
 *
 * This is the only launch endpoint that exists today, and that is deliberate.
 * pump.fun is not deployed on devnet, so the create path cannot be exercised
 * anywhere except mainnet with real SOL — and an unverified instruction that
 * spends money is not something to ship behind a button. The plan is real: the
 * accounts, the costs and the quote asset are all resolved from chain state.
 */
export async function POST(request: Request) {
  let body: {
    launchpad?: unknown;
    name?: unknown;
    symbol?: unknown;
    quoteTicker?: unknown;
    creator?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return badRequest("Body must be JSON.");
  }

  const launchpad = body.launchpad === "pumpfun" ? "pumpfun" : "stonkfun";
  const name = String(body.name ?? "").trim();
  const symbol = String(body.symbol ?? "").trim();
  const creator = asPubkey(body.creator);
  const stock = stockForTicker(String(body.quoteTicker ?? ""));

  if (!name) return badRequest("A name is required.");
  if (!symbol) return badRequest("A symbol is required.");
  if (!stock) return badRequest("Pick a verified stock to price the coin in.");
  if (!creator) return badRequest("Connect a wallet first.");

  return json(await planLaunch({launchpad, name, symbol, stock, creator}));
}
