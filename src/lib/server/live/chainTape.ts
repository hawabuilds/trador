/**
 * The trade tape, read from the chain.
 *
 * GeckoTerminal was the only source, and on busy pools it misses most of the
 * fills. SHOEDOG's Raydium pool made 195 successful swaps in an hour; the tape
 * showed a handful, with a 70-minute hole, because the provider indexes direct
 * pool swaps and most flow arrives through routers — of 99 fills sampled, two
 * were direct Raydium swaps and the rest came via Jupiter, OKX, DFlow, Titan and
 * friends. The chart is built from that same partial feed, so it was wrong too.
 *
 * So the tape is rebuilt from the pool's own transactions, parsed by Helius.
 * Which router sent the swap stops mattering: every fill moves the pool's two
 * vaults, and that movement *is* the trade.
 *
 *   - Our coin's vault is the account for our mint whose owner is not the
 *     signer. Pool vaults share an owner (the AMM's authority).
 *   - The other vault is the account for the pool's other mint with that same
 *     owner, moving the opposite way. The opposite sign is what separates it
 *     from a second pool the same route passed through, which shares the
 *     authority but moves the other mint in the same direction as ours.
 *   - Coin leaving the pool is a buy; coin arriving is a sell. Price is the
 *     ratio of the two movements, priced in USD through the other mint.
 */

import type {Trade} from "@/lib/types";
import type {Pubkey} from "@/lib/pubkey";
import {cached, peek} from "./cache";
import {
  PARSE_BATCH,
  heliusKey,
  parseTransactions,
  signaturesFor,
  uiAmount,
  type ParsedTx,
} from "./helius";
import {jupTokens} from "./jupTokens";

export type {ParsedTx} from "./helius";

/** Enough history to fill recent candles; the chart covers the rest. */
export const TAPE_MAX = 300;
const PAGE = 100;
/** Pages of signatures read when there is nothing cached to extend. */
const COLD_PAGES = 3;
const TTL_MS = 8_000;

/**
 * One fill from one transaction, or null if the pool did not trade our coin.
 *
 * Pure, so the vault rule can be tested against real transaction shapes.
 */
export function fillFromTx(
  tx: ParsedTx,
  mint: string,
  otherMint: string,
  otherUsd: number,
): Trade | null {
  if (tx.transactionError) return null;
  const changes = (tx.accountData ?? []).flatMap((account) => account.tokenBalanceChanges ?? []);

  for (const coinVault of changes) {
    if (coinVault.mint !== mint || coinVault.userAccount === tx.feePayer) continue;
    const coinDelta = uiAmount(coinVault.rawTokenAmount);
    if (!(coinDelta !== 0 && Number.isFinite(coinDelta))) continue;

    const otherVault = changes.find(
      (change) =>
        change.mint === otherMint &&
        change.userAccount === coinVault.userAccount &&
        Math.sign(uiAmount(change.rawTokenAmount)) === -Math.sign(coinDelta),
    );
    if (!otherVault) continue;

    const amount = Math.abs(coinDelta);
    const amountUsd = Math.abs(uiAmount(otherVault.rawTokenAmount)) * otherUsd;
    const priceUsd = amountUsd / amount;
    if (!(Number.isFinite(priceUsd) && priceUsd > 0)) continue;

    const side = coinDelta < 0 ? "buy" : "sell";
    return {
      id: `${tx.signature}:${side === "buy" ? "b" : "s"}`,
      side,
      amount,
      amountUsd,
      priceUsd,
      maker: tx.feePayer,
      txHash: tx.signature,
      makerHandle: null,
      at: new Date(tx.timestamp * 1000).toISOString(),
    };
  }
  return null;
}

/** Newest first, one row per transaction, at most `TAPE_MAX`. */
export function mergeTape(newer: readonly Trade[], older: readonly Trade[]): Trade[] {
  const seen = new Set<string>();
  const out: Trade[] = [];
  for (const trade of [...newer, ...older]) {
    if (seen.has(trade.txHash)) continue;
    seen.add(trade.txHash);
    out.push(trade);
  }
  return out
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, TAPE_MAX);
}

/**
 * Signatures touching the pool since one we already have, newest first.
 *
 * A plain RPC call, and far cheaper than a parsed page — which is the point:
 * an open coin page that nobody is trading should cost almost nothing.
 */
async function signaturesSince(
  pool: Pubkey,
  until: string,
): Promise<{newest: string | null; succeeded: string[]; full: boolean}> {
  const rows = await signaturesFor(pool, {until, limit: PAGE});
  return {
    newest: rows[0]?.signature ?? null,
    succeeded: rows.filter((row) => !row.err).map((row) => row.signature),
    // Counted before dropping failures: a page of 100 with a few failed
    // transactions is still a page that may not reach back far enough.
    full: rows.length >= PAGE,
  };
}

interface TapeState {
  trades: Trade[];
  /** Newest signature seen on the pool, fill or not, so nothing is parsed twice. */
  head: string | null;
}

/**
 * The pool's recent fills, or null when this cannot be answered from chain
 * (no key, or no USD price for the pool's other side) and the caller should
 * fall back.
 *
 * Warm, it asks the cheap question first — has anything happened since the
 * newest fill held? — and only parses what is new. Cold, or after more than a
 * page of activity, it reads parsed pages outright.
 */
export async function chainTradesFor(
  pool: Pubkey,
  mint: Pubkey,
  otherMint: Pubkey,
): Promise<{trades: Trade[]; stale: boolean} | null> {
  const key = heliusKey();
  if (!key) return null;

  const otherUsd = (await jupTokens([otherMint])).get(otherMint)?.usdPrice ?? null;
  if (otherUsd === null || !(otherUsd > 0)) return null;

  const cacheKey = `chain-tape:${pool}:${mint}`;
  const previous = peek<TapeState>(cacheKey);

  const {value, stale} = await cached<TapeState>(cacheKey, TTL_MS, async () => {
    const toFills = (txs: ParsedTx[]) =>
      txs
        .map((tx) => fillFromTx(tx, mint, otherMint, otherUsd))
        .filter((trade): trade is Trade => trade !== null);

    if (previous?.head) {
      const fresh = await signaturesSince(pool, previous.head);
      if (fresh.newest === null) return previous;
      // Less than a page means the list reached back to what we hold, so
      // extending cannot leave a hole. A full page might not have.
      if (!fresh.full) {
        const added = fresh.succeeded.length
          ? toFills(await parseTransactions(fresh.succeeded, key))
          : [];
        return {trades: mergeTape(added, previous.trades), head: fresh.newest};
      }
    }

    // Cold, or too much happened to extend safely: start over. One signature
    // list, then every parse batch at once: three sequential parsed pages took
    // two seconds, and this is the first thing an opened coin waits on.
    const rows = await signaturesFor(pool, {limit: COLD_PAGES * PAGE});
    const head = rows[0]?.signature ?? null;
    const succeeded = rows.filter((row) => !row.err).map((row) => row.signature);
    const batches: string[][] = [];
    for (let i = 0; i < succeeded.length; i += PARSE_BATCH) {
      batches.push(succeeded.slice(i, i + PARSE_BATCH));
    }
    const parsed = await Promise.all(batches.map((batch) => parseTransactions(batch, key)));
    const fills = toFills(parsed.flat());
    return {trades: mergeTape(fills, []), head};
  });

  return {trades: value.trades, stale};
}
