/**
 * Give a just-launched coin a page before the indexer has ever seen it.
 *
 * The indexer only stores a curve once it is close to graduating, so a coin
 * that was created a moment ago is absent from the store on purpose. Its page
 * then 404s — the creator taps "View your coin" and Next says the page could
 * not be found. Confirming the launch is supposed to write the row first.
 * When that write does not land (the account is not visible to the server yet,
 * or the request is dropped), the chain is still the record of the launch.
 *
 * This asks the chain, once, for the pool that mint would have if it were
 * launched here, and writes the same row confirm would have written. Nothing
 * is taken from the URL except the mint. The pool address is derived, and the
 * account has to be owned by the launchpad and priced in a verified stock
 * before a row exists.
 */

import {BorshAccountsCoder} from "@coral-xyz/anchor";
import {bondingCurvePda, PumpIdl} from "@nirholas/pump-sdk";
import {PublicKey} from "@solana/web3.js";

import {curveProgress, decodeStonkfunLaunch} from "@/lib/launchpad/launchpadPool";
import {LAUNCHPAD_POOL, PUMP_PROGRAM, RAYDIUM_LAUNCHPAD} from "@/lib/programs";
import {asPubkey, samePubkey, type Pubkey} from "@/lib/pubkey";
import {stockForMint} from "@/lib/stocks/registry";
import {quoteKindFor} from "@/lib/universe";
import {hasAdminPg} from "../adminPg";
import {hasDatabase} from "../db";
import {invalidate} from "./cache";
import {connection} from "./launchAssemble";
import {findStonk, rowToStonk, upsertStonks, type StonkWrite} from "./universeStore";
import type {Stonk} from "@/lib/types";

const PROGRAM = new PublicKey(RAYDIUM_LAUNCHPAD);

export async function registerLaunchByMint(mint: Pubkey): Promise<Stonk | null> {
  if (!hasDatabase && !hasAdminPg) return null;

  try {
    const write = await launchWriteFor(mint);
    if (!write) return null;

    await upsertStonks([write]);
    // The miss that brought us here is cached. Drop it so the page's own
    // asset read sees the row that was just written.
    invalidate(`store-stonk:${mint}`);

    const found = await findStonk(mint);
    return found ? rowToStonk(found.row, found.stat) : null;
  } catch (error) {
    const message = (error as Error).message.replace(/https?:\/\/\S+/g, "[rpc]");
    console.error("registerLaunch", message);
    return null;
  }
}

async function launchWriteFor(mint: Pubkey): Promise<StonkWrite | null> {
  const mintKey = new PublicKey(mint);
  const rpc = connection();

  const pump = bondingCurvePda(mintKey);
  const curve = await rpc.getAccountInfo(pump, "confirmed");
  if (curve && samePubkey(curve.owner.toBase58(), PUMP_PROGRAM)) {
    const write = pumpWrite(mint, pump.toBase58(), curve.data);
    if (write) return write;
  }

  /*
   * One filtered program scan, not eighty-eight derived PDAs.
   *
   * A StonkFun pool is uniquely keyed by (coin mint, quote mint), so the mint
   * at LaunchLab offset 205 identifies at most one curve per quote — usually
   * one row total. The old path issued a getMultipleAccounts for every stock
   * in the registry on every page miss, which is wallet-scale traffic billed
   * like an indexer pass.
   */
  const pools = await rpc.getProgramAccounts(PROGRAM, {
    commitment: "confirmed",
    filters: [
      {dataSize: LAUNCHPAD_POOL.SPAN},
      {memcmp: {offset: LAUNCHPAD_POOL.MINT_A, bytes: mintKey.toBase58()}},
    ],
  });

  for (const entry of pools) {
    if (!samePubkey(entry.account.owner.toBase58(), RAYDIUM_LAUNCHPAD)) continue;
    const write = stonkfunWrite(mint, entry.pubkey.toBase58(), entry.account.data);
    if (write) return write;
  }

  return null;
}

function stonkfunWrite(mint: Pubkey, pool: string, data: Uint8Array): StonkWrite | null {
  const launch = decodeStonkfunLaunch(data);
  if (!launch?.stock) return null;
  if (!samePubkey(launch.pool.baseMint, mint)) return null;
  if (!samePubkey(launch.pool.quoteMint, launch.stock.mint)) return null;

  const poolAddress = asPubkey(pool);
  if (!poolAddress) return null;

  const graduated = launch.pool.graduated;
  return {
    mint,
    launchpad: "stonkfun",
    pool_kind: "curve",
    pool: poolAddress,
    platform_config: launch.pool.platformId,
    config_kind: launch.configKind,
    creator: launch.pool.creator,
    quote_mint: launch.stock.mint,
    quote_ticker: launch.stock.ticker,
    quote_kind: quoteKindFor(launch.pool.quoteMint),
    pays_holders: launch.paysHolders,
    reward_stock: launch.paysHolders ? launch.stock.ticker : null,
    status: graduated ? "listed" : "pending",
    curve_progress: graduated ? null : curveProgress(launch.pool),
    graduated_at: graduated ? new Date().toISOString() : null,
    eligible: true,
  };
}

function pumpWrite(mint: Pubkey, pool: string, data: Uint8Array): StonkWrite | null {
  let curve: {
    creator: {toBase58(): string};
    quote_mint: {toBase58(): string};
    is_holder_reward: boolean;
  };
  try {
    curve = new BorshAccountsCoder(PumpIdl as never).decode("BondingCurve", Buffer.from(data));
  } catch {
    return null;
  }

  const quote = asPubkey(curve.quote_mint.toBase58());
  const creator = asPubkey(curve.creator.toBase58());
  const poolAddress = asPubkey(pool);
  const stock = quote ? stockForMint(quote) : null;
  if (!quote || !creator || !poolAddress || !stock) return null;

  return {
    mint,
    launchpad: "pumpfun",
    pool_kind: "curve",
    pool: poolAddress,
    platform_config: null,
    config_kind: null,
    creator,
    quote_mint: stock.mint,
    quote_ticker: stock.ticker,
    quote_kind: "stock",
    pays_holders: Boolean(curve.is_holder_reward),
    reward_stock: curve.is_holder_reward ? stock.ticker : null,
    status: "pending",
    curve_progress: 0,
    eligible: true,
    // The quote mint was read off this coin's own curve, which is the check
    // the indexer uses before it will call a pump coin a custom pair.
    is_custom_pair: true,
  };
}
