/**
 * Transactions read raw from the node and reduced to the fields the trade tape
 * reads, in the same shape as a Helius parsed transaction.
 *
 * Helius's parse endpoint was the slow and rate-limited step behind every coin
 * page: 1.4s for a batch of 100, and it refused anything much wider than a few
 * calls at once. The node answers `getTransaction` for 280 signatures in about
 * 0.4s in batches of 50, and the tape needs nothing the raw transaction does
 * not already carry — token balances before and after, the fee payer, the time.
 *
 * `maxSupportedTransactionVersion` is 1, not 0: asked for 0, the node refuses
 * every version-1 transaction, which on a busy pool was one fill in five.
 */

import type {ParsedTx, TokenBalanceChange} from "./helius";

interface RawTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {amount: string; decimals: number};
}

export interface RawTransaction {
  blockTime: number | null;
  meta: {
    err: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: RawTokenBalance[];
    postTokenBalances?: RawTokenBalance[];
    /** Accounts a versioned transaction pulled in through a lookup table. */
    loadedAddresses?: {writable?: string[]; readonly?: string[]};
  } | null;
  transaction: {signatures: string[]; message: {accountKeys: string[]}};
}

/** Signatures per JSON-RPC batch. */
const BATCH = 50;

/**
 * Batches in flight. A thousand signatures is twenty batches, and sending them
 * all at once had the node refusing some, which failed the whole read. Four at
 * a time, alongside the few cold reads a round allows, stays inside what the
 * node serves.
 */
const IN_FLIGHT = 4;

/** A refused batch is retried once, after this long. */
const RETRY_AFTER_MS = 400;

/**
 * Every account this transaction touched, in the index order the balances use.
 *
 * A versioned transaction carries only its static keys in the message; the
 * rest arrive through an address lookup table and are listed separately. The
 * balance arrays cover both, in that order, so the lists have to be joined
 * before an index means anything.
 */
function accountKeys(raw: RawTransaction): string[] {
  return [
    ...raw.transaction.message.accountKeys,
    ...(raw.meta?.loadedAddresses?.writable ?? []),
    ...(raw.meta?.loadedAddresses?.readonly ?? []),
  ];
}

/** Token balance changes, one per token account that moved, by its index. */
function balanceChanges(
  meta: NonNullable<RawTransaction["meta"]>,
  keys: readonly string[],
): Map<number, TokenBalanceChange[]> {
  const byAccount = new Map<number, {mint: string; owner: string; decimals: number; pre: bigint; post: bigint}>();
  const note = (balance: RawTokenBalance, side: "pre" | "post") => {
    const held = byAccount.get(balance.accountIndex) ?? {
      mint: balance.mint,
      owner: balance.owner ?? "",
      decimals: balance.uiTokenAmount.decimals,
      pre: BigInt(0),
      post: BigInt(0),
    };
    held[side] = BigInt(balance.uiTokenAmount.amount);
    byAccount.set(balance.accountIndex, held);
  };
  for (const balance of meta.preTokenBalances ?? []) note(balance, "pre");
  for (const balance of meta.postTokenBalances ?? []) note(balance, "post");

  const changes = new Map<number, TokenBalanceChange[]>();
  for (const [index, account] of byAccount) {
    const delta = account.post - account.pre;
    if (delta === BigInt(0)) continue;
    changes.set(index, [
      {
        userAccount: account.owner,
        // The token account itself, which is how a reader tells rent paid into
        // its own account apart from what it paid for a coin.
        tokenAccount: keys[index] ?? "",
        mint: account.mint,
        rawTokenAmount: {tokenAmount: delta.toString(), decimals: account.decimals},
      },
    ]);
  }
  return changes;
}

/**
 * One transaction, in the shape the trade readers expect.
 *
 * **Native lamports are part of that shape.** They were left out while the
 * only caller was the pool tape, which reads token flows — and a wallet that
 * sold a coin for SOL then appeared to have sold it for the network fee, since
 * the fee was the only lamport movement the reduction could see.
 */
export function reduceRawTransaction(raw: RawTransaction, signature: string): ParsedTx | null {
  if (!raw.meta || raw.blockTime === null) return null;

  const keys = accountKeys(raw);
  const tokens = balanceChanges(raw.meta, keys);
  const pre = raw.meta.preBalances ?? [];
  const post = raw.meta.postBalances ?? [];

  return {
    signature,
    timestamp: raw.blockTime,
    feePayer: keys[0] ?? "",
    fee: raw.meta.fee,
    transactionError: raw.meta.err ?? undefined,
    accountData: keys.map((account, index) => ({
      account,
      nativeBalanceChange: (post[index] ?? 0) - (pre[index] ?? 0),
      tokenBalanceChanges: tokens.get(index) ?? [],
    })),
  };
}

class RateLimited extends Error {
  constructor() {
    super("The node rate limited a transaction batch.");
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function batch(rpc: string, signatures: string[]): Promise<ParsedTx[]> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: {"content-type": "application/json"},
    cache: "no-store",
    body: JSON.stringify(
      signatures.map((signature, id) => ({
        jsonrpc: "2.0",
        id,
        method: "getTransaction",
        params: [
          signature,
          {encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed"},
        ],
      })),
    ),
  });
  if (response.status === 429) throw new RateLimited();
  if (!response.ok) throw new Error(`Transaction batch returned ${response.status}.`);
  const body = (await response.json()) as {id: number; result?: RawTransaction | null}[];
  if (!Array.isArray(body)) throw new Error("Transaction batch returned an unexpected body.");

  const out: ParsedTx[] = [];
  for (const item of body) {
    const signature = signatures[item.id];
    if (!item.result || !signature) continue;
    const parsed = reduceRawTransaction(item.result, signature);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface RawRead {
  transactions: ParsedTx[];
  /**
   * Signatures the node did not return: refused inside the batch, or not yet
   * visible to it. Never dropped quietly — a tape extended past a hole keeps
   * that hole for good, since later rounds only read what is newer.
   */
  missing: string[];
}

/**
 * The node to read raw transactions from, or null when none is configured.
 *
 * Its own setting first, so signature lists and raw tx batches never ride the
 * same Helius quota as wallet traffic or indexer sweeps. Defaults to the
 * public mainnet endpoint when unset — cheap enough for `getTransaction` lists.
 */
export const rawRpc = (): string =>
  process.env.RAW_TX_RPC_URL || "https://api.mainnet-beta.solana.com";

/** Read and reduce transactions, every batch at once, and say which are missing. */
export async function rawTransactions(signatures: string[]): Promise<RawRead> {
  const rpc = rawRpc();
  const batches: string[][] = [];
  for (let i = 0; i < signatures.length; i += BATCH) batches.push(signatures.slice(i, i + BATCH));

  const transactions: ParsedTx[] = [];
  for (let i = 0; i < batches.length; i += IN_FLIGHT) {
    const settled = await Promise.all(
      batches.slice(i, i + IN_FLIGHT).map(async (signatures) => {
        try {
          return await batch(rpc, signatures);
        } catch (error) {
          if (!(error instanceof RateLimited)) throw error;
          await sleep(RETRY_AFTER_MS);
          // Once. Whatever is still refused is left to the caller, which takes
          // the run it did read and comes back for the rest.
          return batch(rpc, signatures).catch(() => []);
        }
      }),
    );
    for (const read of settled) transactions.push(...read);
  }

  const read = new Set(transactions.map((tx) => tx.signature));
  return {transactions, missing: signatures.filter((signature) => !read.has(signature))};
}
