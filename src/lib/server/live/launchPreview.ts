/**
 * What a launch will cost, before anything is signed.
 *
 * Everything on the bill comes from a mainnet simulation:
 *
 *   - **The launch** is built for the creator's own wallet and simulated, with
 *     a metadata address the same length as the real one — the coin's on-chain
 *     metadata is sized to it, so a shorter placeholder would under-quote rent.
 *   - **The swap** that turns SOL into the stock is a real Jupiter route,
 *     simulated against the creator's wallet.
 *   - **The dev buy** is where a simulation needs help: the creator does not
 *     hold the stock yet, so a buy from their wallet can only fail. What the
 *     curve pays out does not depend on who buys, so the same launch-and-buy is
 *     simulated from a wallet that already holds the stock. Coins out and the
 *     launchpad's cut are then the program's own numbers, not curve maths
 *     re-implemented here and hoped to match.
 */

import {PublicKey} from "@solana/web3.js";

import {type Pubkey} from "@/lib/pubkey";
import type {StockMint} from "@/lib/stocks/registry";
import {cached} from "./cache";
import {buildStonkfunLaunch} from "./launchBuild";
import {
  type CostLine,
  type DevBuyResult,
  LaunchRefused,
  connection,
  devBuySwap,
  stockBalance,
} from "./launchAssemble";
import {buildPumpLaunch} from "./pumpLaunch";

export type LaunchpadChoice = "stonkfun" | "pumpfun";

export interface LaunchOptions {
  launchpad: LaunchpadChoice;
  creator: Pubkey;
  name: string;
  symbol: string;
  uri: string;
  stock: StockMint;
  /** StonkFun: the holder-reward transfer fee. */
  feeBps: number;
  /** pump.fun: creator fees to holders instead of the creator. */
  holderReward: boolean;
  /** pump.fun: the creator fee rate; 0 for pump.fun's standard schedule. */
  creatorFeeBps: number;
  devBuyStock: bigint;
}

export function buildLaunch(options: LaunchOptions) {
  const common = {
    creator: options.creator,
    name: options.name,
    symbol: options.symbol,
    uri: options.uri,
    stock: options.stock,
    devBuyStock: options.devBuyStock,
  };
  return options.launchpad === "pumpfun"
    ? buildPumpLaunch({
        ...common,
        holderReward: options.holderReward,
        creatorFeeBps: options.creatorFeeBps,
      })
    : buildStonkfunLaunch({...common, feeBps: options.feeBps});
}

/**
 * A wallet that holds at least `amount` of the stock and SOL for fees, to
 * simulate a dev buy from. Read from the stock's largest holders; only plain
 * wallets qualify, since a program-owned account cannot pay fees.
 */
async function stockHolder(stock: StockMint, amount: bigint): Promise<Pubkey | null> {
  const {value: holders} = await cached(`stock-holders:${stock.mint}`, 3_600_000, async () => {
    const rpc = connection();
    const largest = await rpc.getTokenLargestAccounts(new PublicKey(stock.mint));
    const accounts = await rpc.getMultipleParsedAccounts(largest.value.map((entry) => entry.address));
    const owners = accounts.value.map((account, index) => {
      const parsed = (account?.data as {parsed?: {info?: {owner?: string}}} | undefined)?.parsed;
      return {owner: parsed?.info?.owner ?? null, amount: largest.value[index].amount};
    });
    const wallets = await rpc.getMultipleAccountsInfo(
      owners.map((entry) => new PublicKey(entry.owner ?? PublicKey.default)),
    );
    return owners
      .map((entry, index) => ({...entry, info: wallets[index]}))
      .filter(
        (entry) =>
          entry.owner &&
          entry.info?.owner.equals(new PublicKey("11111111111111111111111111111111")) &&
          entry.info.lamports >= 50_000_000,
      )
      .map((entry) => ({owner: entry.owner as Pubkey, amount: entry.amount}));
  });
  return holders.find((entry) => BigInt(entry.amount) >= amount)?.owner ?? null;
}

export interface LaunchPreview {
  launchpad: LaunchpadChoice;
  /** The launch transaction's own bill (including the buy, when there is one). */
  launchCosts: CostLine[];
  launchLamports: number;
  /** Present when SOL has to be swapped into the stock first. */
  swap: {
    solIn: number;
    stockOut: number;
    stockMinOut: number;
    priceImpactPct: number;
    route: string[];
    overheadLamports: number;
  } | null;
  devBuy: DevBuyResult | null;
  /** Stock the launch step should spend, in base units. */
  devBuyStock: string;
  /** SOL leaving the wallet in total, across every step. */
  totalLamports: number;
  balanceLamports: number;
  /** One approval, or two when a swap goes first. */
  signatures: 1 | 2;
  stockTicker: string;
}

export async function previewLaunch(
  options: Omit<LaunchOptions, "devBuyStock"> & {devBuyLamports: bigint},
): Promise<LaunchPreview> {
  const creator = new PublicKey(options.creator);
  const bare = {...options, devBuyStock: 0n};

  if (options.devBuyLamports <= 0n) {
    const launch = await buildLaunch(bare);
    return {
      launchpad: options.launchpad,
      launchCosts: launch.costs,
      launchLamports: launch.totalLamports,
      swap: null,
      devBuy: null,
      devBuyStock: "0",
      totalLamports: launch.totalLamports,
      balanceLamports: launch.balanceLamports,
      signatures: 1,
      stockTicker: options.stock.ticker,
    };
  }

  // The swap is priced even when the wallet already holds the stock: it is
  // how a SOL amount becomes a stock amount.
  const [held, swap] = await Promise.all([
    stockBalance(creator, options.stock.mint),
    devBuySwap({creator: options.creator, stockMint: options.stock.mint, lamports: options.devBuyLamports}),
  ]);
  const needsSwap = held < swap.stockOut;
  // Spend the swap's floor, never its estimate, so the launch can't ask for
  // stock the swap did not deliver.
  const stockIn = needsSwap ? swap.stockMinOut : swap.stockOut;

  const holder = needsSwap ? await stockHolder(options.stock, stockIn) : options.creator;
  if (!holder) {
    throw new LaunchRefused(`Couldn't preview a ${options.stock.ticker} dev buy right now. Try again, or launch without one.`);
  }

  // The launch-and-buy, from a wallet that can actually make the buy.
  const withBuy = await buildLaunch({...options, creator: holder, devBuyStock: stockIn});
  // And the creator's own balance, which the proxy's simulation can't show.
  const balanceLamports = needsSwap ? await connection().getBalance(creator) : withBuy.balanceLamports;

  const swapLamports = needsSwap ? Number(options.devBuyLamports) + swap.overheadLamports : 0;
  return {
    launchpad: options.launchpad,
    launchCosts: withBuy.costs,
    launchLamports: withBuy.totalLamports,
    swap: needsSwap
      ? {
          solIn: swap.solIn,
          stockOut: Number(swap.stockOut) / 10 ** options.stock.decimals,
          stockMinOut: Number(swap.stockMinOut) / 10 ** options.stock.decimals,
          priceImpactPct: swap.priceImpactPct,
          route: swap.route,
          overheadLamports: swap.overheadLamports,
        }
      : null,
    devBuy: withBuy.devBuy,
    devBuyStock: stockIn.toString(),
    totalLamports: withBuy.totalLamports + swapLamports,
    balanceLamports,
    signatures: needsSwap ? 2 : 1,
    stockTicker: options.stock.ticker,
  };
}
