/**
 * The scaled multiplier each mint is carrying right now.
 *
 * Read live rather than stored, because it moves on its own: an issuer nudges
 * it up as a dividend accrues and jumps it on a split. A value frozen into the
 * registry would be right the day it was generated and quietly wrong after.
 *
 * Cached for ten minutes. The whole stock registry is one call, and a number
 * that changes a few times a year does not need asking about per request.
 */

import {effectiveMultiplier, type ScaledConfig} from "@/lib/scaledAmount";
import {cached} from "./cache";
import {rawRpc} from "./rawTransactions";

/** Mints per `getMultipleAccounts` call. */
const BATCH = 100;

const TTL_MS = 10 * 60_000;

async function read(mints: readonly string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const rpc = rawRpc();

  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);
    const response = await fetch(rpc, {
      method: "POST",
      headers: {"content-type": "application/json"},
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [batch, {encoding: "jsonParsed"}],
      }),
    });
    if (!response.ok) throw new Error(`Mint read returned ${response.status}.`);

    const body = (await response.json()) as {
      result?: {value: ({data?: {parsed?: {info?: {extensions?: {extension: string; state: ScaledConfig}[]}}}} | null)[]};
    };

    batch.forEach((mint, index) => {
      const extensions = body.result?.value?.[index]?.data?.parsed?.info?.extensions ?? [];
      const config = extensions.find((e) => e.extension === "scaledUiAmountConfig")?.state;
      found.set(mint, effectiveMultiplier(config));
    });
  }

  return found;
}

/**
 * Multipliers for a set of mints, 1 for anything without the extension.
 *
 * A failure returns 1 for everything rather than throwing: the multiplier
 * corrects a number, and a correction that cannot be read must not take the
 * number away. The figure is then as wrong as it was before this existed,
 * which is the floor, not a new failure.
 */
export async function multipliersFor(
  mints: readonly string[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(mints)].sort();
  if (wanted.length === 0) return new Map();

  try {
    const {value} = await cached(`scaled:${wanted.join(",")}`, TTL_MS, () => read(wanted));
    return value;
  } catch (error) {
    console.error("reading scaled multipliers failed", error);
    return new Map(wanted.map((mint) => [mint, 1]));
  }
}
