import {asPubkey} from "@/lib/pubkey";
import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {stockForTicker} from "@/lib/stocks/registry";

export const dynamic = "force-dynamic";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  const body = (await response.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

/**
 * Register a launch that has landed, so it shows up in Trador straight away.
 *
 * Without this a new coin would be invisible here until the indexer's
 * graduating sweep happened to reach it — and that sweep only lists launches
 * already a tenth of the way up their curve, so a brand-new coin would never
 * appear at all until it had momentum. Its creator would launch it and find no
 * page for it.
 *
 * Nothing is taken on trust. The pool must exist on chain, be owned by
 * LaunchLab, and name StonkFun's platform, the claimed mint and the claimed
 * stock — the same attribution rule the indexer applies. A request that names a
 * coin that is not really there writes nothing.
 */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (caller instanceof Response) return caller;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const mint = asPubkey(typeof body.mint === "string" ? body.mint : null);
  const pool = asPubkey(typeof body.pool === "string" ? body.pool : null);
  const stock = stockForTicker(typeof body.quoteTicker === "string" ? body.quoteTicker : "");
  if (!mint || !pool || !stock) return badRequest("Which launch?");

  try {
    const account = await rpc<{value: {owner: string; data: [string, string]} | null}>(
      "getAccountInfo",
      [pool, {encoding: "base64", commitment: "confirmed"}],
    );
    if (!account.value || account.value.owner !== RAYDIUM_LAUNCHPAD) {
      return json({error: "That launch is not on chain yet."}, {status: 404});
    }

    const data = Buffer.from(account.value.data[0], "base64");
    const {readPubkeyAt} = await import("@/lib/pubkey");
    const platform = readPubkeyAt(data, 173);
    const onChainMint = readPubkeyAt(data, 205);
    const quote = readPubkeyAt(data, 237);
    const creator = readPubkeyAt(data, 333);

    const rewards = STONKFUN_PLATFORMS.find((entry) => entry.kind === "rewards")!;
    if (platform !== rewards.platformId || onChainMint !== mint || quote !== stock.mint) {
      return json({error: "That pool is not the launch described."}, {status: 409});
    }

    const {upsertStonks} = await import("@/lib/server/live/universeStore");
    await upsertStonks([
      {
        mint,
        launchpad: "stonkfun",
        pool_kind: "curve",
        pool,
        platform_config: rewards.platformId,
        config_kind: "rewards",
        creator,
        quote_mint: stock.mint,
        quote_ticker: stock.ticker,
        quote_kind: "stock",
        pays_holders: true,
        reward_stock: stock.ticker,
        // On the curve until it graduates; the graduating sweep takes it from
        // here and the decorate pass fills in the rest.
        status: "pending",
        curve_progress: 0,
        symbol: typeof body.symbol === "string" ? body.symbol.slice(0, 10) : null,
        name: typeof body.name === "string" ? body.name.slice(0, 32) : null,
        image_url: typeof body.image === "string" && body.image.startsWith("https://") ? body.image : null,
        image_source: "trador",
        eligible: true,
      },
    ]);

    return json({ok: true, mint});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
