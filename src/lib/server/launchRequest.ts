/**
 * Reading a launch request, once, for every launch route.
 *
 * Preview, swap and build all take the same form, and each checking it
 * separately is how one of them ends up accepting a ticker the others refuse.
 */

import {type Pubkey, asPubkey} from "@/lib/pubkey";
import {type StockMint, stockForTicker} from "@/lib/stocks/registry";
import type {LaunchpadChoice} from "./live/launchPreview";

export interface LaunchForm {
  launchpad: LaunchpadChoice;
  name: string;
  symbol: string;
  creator: Pubkey;
  stock: StockMint;
  feeBps: number;
  holderReward: boolean;
  creatorFeeBps: number;
  devBuyLamports: bigint;
}

/** The most a dev buy may spend here, in SOL. A guard against a typo, not a limit on anyone. */
export const MAX_DEV_BUY_SOL = 50;

export function readLaunchForm(body: Record<string, unknown>): LaunchForm | string {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const launchpad = text(body.launchpad) === "pumpfun" ? "pumpfun" : "stonkfun";
  const name = text(body.name);
  const symbol = text(body.symbol).replace(/^\$/, "").toUpperCase();
  const creator = asPubkey(text(body.creator));
  const stock = stockForTicker(text(body.quoteTicker));
  const devBuySol = Number(body.devBuySol ?? 0);

  // Token metadata limits: a name longer than 32 bytes or a symbol longer than
  // 10 is rejected by the metadata program after the fee is paid.
  if (!name || Buffer.byteLength(name) > 32) return "Give it a name, 32 characters at most.";
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return "The ticker is 1–10 letters or numbers.";
  if (!creator) return "No wallet to launch from.";
  if (!stock) return "Pick a stock to price it in.";
  if (!Number.isFinite(devBuySol) || devBuySol < 0) return "The dev buy must be a positive amount of SOL.";
  if (devBuySol > MAX_DEV_BUY_SOL) return `A dev buy here is at most ${MAX_DEV_BUY_SOL} SOL.`;

  return {
    launchpad,
    name,
    symbol,
    creator,
    stock,
    feeBps: Number(body.feeBps ?? 100),
    holderReward: body.holderReward === true,
    creatorFeeBps: Math.max(0, Math.round(Number(body.creatorFeeBps ?? 0))),
    devBuyLamports: BigInt(Math.round(devBuySol * 1e9)),
  };
}
