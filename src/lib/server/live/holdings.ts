/**
 * What a wallet actually holds.
 *
 * Read from the chain, not from a provider's idea of a portfolio.
 * `getTokenAccountsByOwner` with `jsonParsed` returns every token account in
 * one call, which is both cheaper and more honest than asking an indexer what
 * it thinks someone owns.
 *
 * Balances are then intersected with the store: a wallet holds all sorts of
 * things, and Trador only claims to know about the coins and stocks in its own
 * universe. Anything else is counted as "other" rather than silently dropped,
 * so the total never quietly disagrees with a block explorer.
 */

import {TOKEN_2022_PROGRAM, TOKEN_PROGRAM} from "@/lib/programs";
import {type Pubkey} from "@/lib/pubkey";
import {snapshotStocks, snapshotStonks} from "@/lib/server/snapshot";
import {hasDatabase} from "@/lib/server/db";
import type {Asset, Holding} from "@/lib/types";
import {cached} from "./cache";

const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

interface ParsedTokenAccount {
  account: {
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {amount?: string; decimals?: number; uiAmount?: number | null};
        };
      };
    };
  };
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}.`);
  const body = (await response.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

export interface Stonkfolio {
  holdings: Holding[];
  /** Value of tokens held that are not in Trador's universe. */
  otherCount: number;
  solLamports: number;
  totalUsd: number;
  stale: boolean;
}

export async function stonkfolioFor(wallet: Pubkey): Promise<Stonkfolio> {
  const {value, stale} = await cached(`holdings:${wallet}`, 20_000, async () => {
    // Both token programs. Every verified stock is Token-2022, and coins are
    // classic SPL — querying only one would silently hide half the portfolio.
    const [classic, token2022, balance] = await Promise.all([
      rpc<{value: ParsedTokenAccount[]}>("getTokenAccountsByOwner", [
        wallet,
        {programId: TOKEN_PROGRAM},
        {encoding: "jsonParsed", commitment: "confirmed"},
      ]),
      rpc<{value: ParsedTokenAccount[]}>("getTokenAccountsByOwner", [
        wallet,
        {programId: TOKEN_2022_PROGRAM},
        {encoding: "jsonParsed", commitment: "confirmed"},
      ]),
      rpc<{value: number}>("getBalance", [wallet, {commitment: "confirmed"}]),
    ]);

    const byMint = new Map<string, number>();
    for (const entry of [...classic.value, ...token2022.value]) {
      const info = entry.account.data.parsed?.info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.uiAmount;
      if (!mint || typeof amount !== "number" || amount <= 0) continue;
      byMint.set(mint, (byMint.get(mint) ?? 0) + amount);
    }

    const universe = await universeFor([...byMint.keys()]);

    const holdings: Holding[] = [];
    let otherCount = 0;
    let totalUsd = 0;

    for (const [mint, amount] of byMint) {
      const asset = universe.get(mint);
      if (!asset) {
        otherCount += 1;
        continue;
      }
      const price = asset.price.usd;
      // Null rather than 0 when unpriced: a holding whose price is unknown is
      // not a holding worth nothing, and it must not drag the total down.
      const valueUsd = price === null ? null : price * amount;
      if (valueUsd !== null) totalUsd += valueUsd;
      holdings.push({asset, amount, valueUsd});
    }

    holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    return {holdings, otherCount, solLamports: balance.value, totalUsd};
  });

  return {...value, stale};
}

export interface Balances {
  /** Native SOL, in lamports, as a decimal string. */
  lamports: string;
  /** Raw base units per requested mint, summed across every account for it. */
  tokens: Record<string, {amount: string; decimals: number}>;
}

/**
 * Exactly what a wallet holds of a few mints, for the order ticket.
 *
 * Raw base units rather than `uiAmount`: the ticket sizes "sell all" from this
 * and has to send precisely the balance, which a float cannot promise.
 *
 * Filtered by mint, so it works for classic SPL and Token-2022 alike without
 * asking about either program, and costs one call per mint instead of a scan of
 * the whole wallet. Uncached on purpose — the ticket refetches straight after a
 * trade, and a cached pre-trade balance is exactly the wrong answer then.
 */
export async function balancesFor(wallet: Pubkey, mints: readonly Pubkey[]): Promise<Balances> {
  const [balance, ...perMint] = await Promise.all([
    rpc<{value: number}>("getBalance", [wallet, {commitment: "confirmed"}]),
    ...mints.map((mint) =>
      rpc<{value: ParsedTokenAccount[]}>("getTokenAccountsByOwner", [
        wallet,
        {mint},
        {encoding: "jsonParsed", commitment: "confirmed"},
      ]),
    ),
  ]);

  const tokens: Balances["tokens"] = {};
  mints.forEach((mint, index) => {
    let total = 0n;
    let decimals = 0;
    for (const entry of perMint[index].value) {
      const amount = entry.account.data.parsed?.info?.tokenAmount;
      if (!amount?.amount || !/^\d+$/.test(amount.amount)) continue;
      total += BigInt(amount.amount);
      decimals = amount.decimals ?? decimals;
    }
    tokens[mint] = {amount: total.toString(), decimals};
  });

  return {lamports: String(balance.value), tokens};
}

/**
 * The assets behind a set of held mints.
 *
 * **The store first, and the snapshot only as a floor.** This used to build the
 * universe from the bundled snapshot alone — 140 coins frozen at generation
 * time, against the 694 the indexer now knows. A coin bought today was not in
 * that file, so it was counted as "other" and vanished from the portfolio while
 * sitting plainly in the wallet. Someone who had just spent real money was told
 * they owned nothing.
 *
 * Looked up by the mints actually held, so the cost is one query for a wallet
 * rather than a scan of the universe. Prices come from the store too, which is
 * what makes a position worth what the coin is worth now rather than what it
 * was worth when the snapshot was cut.
 *
 * The snapshot still fills any mint the store does not answer for, so a
 * deployment with no database shows a portfolio instead of an empty one.
 */
async function universeFor(mints: readonly string[]): Promise<Map<string, Asset>> {
  const universe = new Map<string, Asset>();

  // Stocks come from the registry and are priced live; there are 82 of them and
  // the call is cached, so this is not worth narrowing to the ones held.
  try {
    const {fetchStocks} = await import("@/lib/server/sources");
    for (const stock of (await fetchStocks()).items) universe.set(stock.mint, stock);
  } catch {
    for (const stock of snapshotStocks().items) universe.set(stock.mint, stock);
  }

  if (hasDatabase) {
    try {
      const {rowToStonk, stonksByMints} = await import("./universeStore");
      const rows = await stonksByMints(mints as Pubkey[]);
      for (const [mint, {row, stat}] of rows) {
        universe.set(mint, rowToStonk(row, stat));
      }
    } catch {
      // Falls through to the snapshot below rather than emptying the portfolio.
    }
  }

  // Anything the store did not answer for, from the bundled floor.
  for (const stonk of snapshotStonks().items) {
    if (!universe.has(stonk.mint)) universe.set(stonk.mint, stonk);
  }

  return universe;
}
