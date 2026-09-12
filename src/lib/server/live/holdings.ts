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

    const universe = new Map<string, Asset>();
    for (const stonk of snapshotStonks().items) universe.set(stonk.mint, stonk);
    for (const stock of snapshotStocks().items) universe.set(stock.mint, stock);

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
