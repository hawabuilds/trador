import {asPubkey} from "@/lib/pubkey";
import {requireCaller} from "@/lib/server/auth";
import {badRequest, json} from "@/lib/server/http";
import {PUMP_PROGRAM, RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {stockForTicker} from "@/lib/stocks/registry";
import {serverRpcUrl} from "@/lib/server/rpcUrl";

export const dynamic = "force-dynamic";

const RPC_URL = serverRpcUrl();

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
 * Nothing is taken on trust. For StonkFun the pool must exist on chain, be
 * owned by LaunchLab, and name StonkFun's platform, the claimed mint and the
 * claimed stock — the same attribution rule the indexer applies. For pump.fun
 * the curve must sit at the mint's own PDA and be quoted in the claimed stock. A request that names a
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

  const launchpad = body.launchpad === "pumpfun" ? "pumpfun" : "stonkfun";
  const symbol = typeof body.symbol === "string" ? body.symbol.slice(0, 10) : null;
  const name = typeof body.name === "string" ? body.name.slice(0, 32) : null;
  const image = typeof body.image === "string" && body.image.startsWith("https://") ? body.image : null;

  try {
    const account = await rpc<{value: {owner: string; data: [string, string]} | null}>(
      "getAccountInfo",
      [pool, {encoding: "base64", commitment: "confirmed"}],
    );
    const owner = launchpad === "pumpfun" ? PUMP_PROGRAM : RAYDIUM_LAUNCHPAD;
    if (!account.value || account.value.owner !== owner) {
      return json({error: "That launch is not on chain yet."}, {status: 404});
    }
    const data = Buffer.from(account.value.data[0], "base64");
    const {upsertStonks} = await import("@/lib/server/live/universeStore");

    if (launchpad === "pumpfun") {
      /*
       * A pump.fun curve: the account at the mint's `bonding-curve` PDA,
       * decoded with pump.fun's own IDL, quoted in the claimed stock.
       */
      const {BorshAccountsCoder} = await import("@coral-xyz/anchor");
      const {PumpIdl, bondingCurvePda} = await import("@nirholas/pump-sdk");
      if (bondingCurvePda(mint).toBase58() !== pool) {
        return json({error: "That is not this coin's curve."}, {status: 409});
      }
      const curve = new BorshAccountsCoder(PumpIdl as never).decode("BondingCurve", data) as {
        creator: {toBase58(): string};
        quote_mint: {toBase58(): string};
        is_holder_reward: boolean;
      };
      if (curve.quote_mint.toBase58() !== stock.mint) {
        return json({error: "That curve is not priced in that stock."}, {status: 409});
      }

      await upsertStonks([
        {
          mint,
          launchpad: "pumpfun",
          pool_kind: "curve",
          pool,
          platform_config: null,
          config_kind: null,
          creator: curve.creator.toBase58(),
          quote_mint: stock.mint,
          quote_ticker: stock.ticker,
          quote_kind: "stock",
          // Creator fees routed to holders is pump.fun's holder reward.
          pays_holders: Boolean(curve.is_holder_reward),
          reward_stock: curve.is_holder_reward ? stock.ticker : null,
          status: "pending",
          curve_progress: 0,
          symbol,
          name,
          image_url: image,
          image_source: "trador",
          eligible: true,
        },
      ]);
      return json({ok: true, mint});
    }

    const {readPubkeyAt} = await import("@/lib/pubkey");
    const platform = readPubkeyAt(data, 173);
    const onChainMint = readPubkeyAt(data, 205);
    const quote = readPubkeyAt(data, 237);
    const creator = readPubkeyAt(data, 333);

    const rewards = STONKFUN_PLATFORMS.find((entry) => entry.kind === "rewards")!;
    if (platform !== rewards.platformId || onChainMint !== mint || quote !== stock.mint) {
      return json({error: "That pool is not the launch described."}, {status: 409});
    }

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
        symbol,
        name,
        image_url: image,
        image_source: "trador",
        eligible: true,
      },
    ]);

    return json({ok: true, mint});
  } catch (error) {
    return json({error: (error as Error).message}, {status: 503});
  }
}
