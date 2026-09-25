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
  heliusKey,
  HeliusRateLimited,
  PARSE_MAX_PER_ROUND,
  type SignatureRow,
  parseTransactionsInBatches,
  signaturesFor,
  uiAmount,
  type ParsedTx,
} from "./helius";
import {jupTokens} from "./jupTokens";
import {rawRpc, rawTransactions} from "./rawTransactions";

export type {ParsedTx} from "./helius";

/** Enough history to fill recent candles; the chart covers the rest. */
export const TAPE_MAX = 300;
const PAGE = 100;
/** Pages of signatures read when there is nothing cached to extend. */
const COLD_PAGES = 3;
/**
 * Signatures per parse call on a cold load. Helius takes as long for 100 as the
 * response is large (1.4s), so smaller batches side by side finish sooner; 50
 * is where it stopped helping, since 25 at a time runs into its rate limit.
 */
const COLD_BATCH = 25;
/** Listed pools extend often; curve pages poll more slowly and hold longer. */
const TTL_MS = 8_000;
export const CURVE_TTL_MS = 45_000;

export interface ChainTapeOptions {
  ttlMs?: number;
}

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
    return tradeFromDeltas(tx, side, amount, amountUsd, priceUsd);
  }

  /*
   * Bonding-curve buys and sells move the signer's token accounts, not a pair
   * of pool vaults sharing an AMM authority. The same price rule applies once
   * the two legs are found on the fee payer.
   */
  for (const coinChange of changes) {
    if (coinChange.mint !== mint || coinChange.userAccount !== tx.feePayer) continue;
    const coinDelta = uiAmount(coinChange.rawTokenAmount);
    if (!(coinDelta !== 0 && Number.isFinite(coinDelta))) continue;

    const otherChange = changes.find(
      (change) =>
        change.mint === otherMint &&
        change.userAccount === tx.feePayer &&
        Math.sign(uiAmount(change.rawTokenAmount)) === -Math.sign(coinDelta),
    );
    if (!otherChange) continue;

    const amount = Math.abs(coinDelta);
    const amountUsd = Math.abs(uiAmount(otherChange.rawTokenAmount)) * otherUsd;
    const priceUsd = amountUsd / amount;
    if (!(Number.isFinite(priceUsd) && priceUsd > 0)) continue;

    const side = coinDelta > 0 ? "buy" : "sell";
    return tradeFromDeltas(tx, side, amount, amountUsd, priceUsd);
  }
  return null;
}

function tradeFromDeltas(
  tx: ParsedTx,
  side: "buy" | "sell",
  amount: number,
  amountUsd: number,
  priceUsd: number,
): Trade {
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
): Promise<{rows: SignatureRow[]; newest: string | null; succeeded: string[]; full: boolean}> {
  const rows = await signaturesFor(pool, {until, limit: PAGE});
  return {
    rows,
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
  /** Set on the round that could not parse every signature. */
  unreadable?: number;
}

/**
 * Transactions in the shape `fillFromTx` reads, keyed by signature.
 *
 * Raw from the node when one is configured, since that is about three times
 * faster and not rate limited the way Helius's parser is, and Helius's parser
 * when the node has none of it or is not configured.
 *
 * What the node does not return is left out rather than chased. The newest
 * signatures are often a second or two ahead of what a node will serve, and
 * asking Helius for each of those gaps every round is what made it start
 * refusing. The caller handles the gap instead, by taking only the unbroken
 * run of transactions it did read.
 */
interface DecodeResult {
  read: Map<string, ParsedTx>;
  /** Signatures that could not be parsed — the tape still uses what was read. */
  unreadable: number;
}

async function decode(signatures: string[], key: string | null): Promise<DecodeResult> {
  const read = new Map<string, ParsedTx>();
  if (signatures.length === 0) return {read, unreadable: 0};

  let missing = signatures;
  if (rawRpc()) {
    try {
      const raw = await rawTransactions(signatures);
      for (const tx of raw.transactions) read.set(tx.signature, tx);
      missing = raw.missing;
    } catch (error) {
      if (!key) throw error;
    }
  }

  /*
   * Helius only when the node returned nothing. Warm extends leave gaps —
   * newest signatures are often a second ahead of the node, and chasing
   * each miss on Enhanced parse is what 429s the indexer key and stalls
   * discovery. unbrokenRun marks below the gap so the next round retries.
   */
  if (missing.length > 0 && read.size === 0) {
    if (!key || PARSE_MAX_PER_ROUND <= 0) {
      throw new Error("No way to read transactions is configured.");
    }
    let toParse = missing;
    if (PARSE_MAX_PER_ROUND > 0 && toParse.length > PARSE_MAX_PER_ROUND) {
      toParse = toParse.slice(0, PARSE_MAX_PER_ROUND);
    }
    try {
      const parsed = await parseTransactionsInBatches(toParse, key, COLD_BATCH);
      for (const tx of parsed) read.set(tx.signature, tx);
    } catch (error) {
      if (!(error instanceof HeliusRateLimited) || read.size === 0) throw error;
    }
  }

  const unreadable = signatures.filter((signature) => !read.has(signature)).length;
  if (read.size === 0) throw new Error(`${signatures.length} transactions could not be read.`);
  return {read, unreadable};
}

/**
 * The newest unbroken run of a signature list, and the signature to mark as
 * read up to.
 *
 * A node is often a second or two behind the newest signatures, so a read can
 * come back with a gap. Fills are taken from the newest end down to that gap,
 * and the mark is set to the signature *below* it — not the newest one read.
 * A tape only ever extends forwards, from everything newer than its mark, so a
 * mark above the gap would skip those transactions for good, while one below
 * it means the next round reads them.
 */
function unbrokenRun(
  rows: readonly SignatureRow[],
  read: Map<string, ParsedTx>,
): {transactions: ParsedTx[]; head: string | null} {
  const transactions: ParsedTx[] = [];
  for (const [index, row] of rows.entries()) {
    // A failed transaction is nothing to read and cannot hide a fill.
    if (row.err) continue;
    const tx = read.get(row.signature);
    if (!tx) {
      // The gap: mark the row below it, so this one is read next time.
      return {transactions, head: rows[index + 1]?.signature ?? null};
    }
    transactions.push(tx);
  }
  return {transactions, head: rows[0]?.signature ?? null};
}

/** Whether a tape for this pool is already held, so a read would only extend it. */
export function hasChainTape(pool: Pubkey, mint: Pubkey): boolean {
  return peek<TapeState>(`chain-tape:${pool}:${mint}`) !== null;
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
  /**
   * Signatures read when there is nothing to extend. On a pool whose traffic
   * is mostly cranks and routing, 300 can reach back only a couple of minutes,
   * so the worker — which does this once per restart — reads far deeper than a
   * page, which is paying for it while someone waits.
   */
  coldLimit = COLD_PAGES * PAGE,
  options: ChainTapeOptions = {},
): Promise<{trades: Trade[]; stale: boolean; warning: string | null} | null> {
  const key = heliusKey();
  if (!key && !rawRpc()) return null;

  const otherUsd = (await jupTokens([otherMint])).get(otherMint)?.usdPrice ?? null;
  if (otherUsd === null || !(otherUsd > 0)) return null;

  const cacheKey = `chain-tape:${pool}:${mint}`;
  const previous = peek<TapeState>(cacheKey);
  const ttlMs = options.ttlMs ?? TTL_MS;

  const {value, stale} = await cached<TapeState>(cacheKey, ttlMs, async () => {
    let unreadable = 0;
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
        const decoded = await decode(fresh.succeeded, key);
        unreadable = decoded.unreadable;
        const run = unbrokenRun(fresh.rows, decoded.read);
        return {
          trades: mergeTape(toFills(run.transactions), previous.trades),
          head: run.head ?? previous.head,
          unreadable,
        };
      }
    }

    // Cold, or too much happened to extend safely: start over. One signature
    // list, then every transaction at once: three sequential parsed pages took
    // two seconds, and this is the first thing an opened coin waits on.
    const rows = await signaturesFor(pool, {limit: coldLimit});
    const succeeded = rows.filter((row) => !row.err).map((row) => row.signature);
    const decoded = await decode(succeeded, key);
    unreadable = decoded.unreadable;
    const run = unbrokenRun(rows, decoded.read);
    return {
      trades: mergeTape(toFills(run.transactions), []),
      head: run.head,
      unreadable,
    };
  });

  const warning =
    value.unreadable && value.unreadable > 0
      ? `${value.unreadable} transactions could not be read.`
      : null;
  return {trades: value.trades, stale, warning};
}
