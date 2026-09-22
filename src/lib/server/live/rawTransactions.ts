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

interface RawTransaction {
  blockTime: number | null;
  meta: {
    err: unknown;
    fee?: number;
    preTokenBalances?: RawTokenBalance[];
    postTokenBalances?: RawTokenBalance[];
  } | null;
  transaction: {signatures: string[]; message: {accountKeys: string[]}};
}

/** Signatures per JSON-RPC batch. */
const BATCH = 50;

/** Token balance changes, one per token account that moved. */
function balanceChanges(meta: NonNullable<RawTransaction["meta"]>): TokenBalanceChange[] {
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

  const changes: TokenBalanceChange[] = [];
  for (const account of byAccount.values()) {
    const delta = account.post - account.pre;
    if (delta === BigInt(0)) continue;
    changes.push({
      userAccount: account.owner,
      tokenAccount: "",
      mint: account.mint,
      rawTokenAmount: {tokenAmount: delta.toString(), decimals: account.decimals},
    });
  }
  return changes;
}

function toParsed(raw: RawTransaction, signature: string): ParsedTx | null {
  if (!raw.meta || raw.blockTime === null) return null;
  return {
    signature,
    timestamp: raw.blockTime,
    feePayer: raw.transaction.message.accountKeys[0] ?? "",
    fee: raw.meta.fee,
    transactionError: raw.meta.err ?? undefined,
    accountData: [{tokenBalanceChanges: balanceChanges(raw.meta)}],
  };
}

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
  if (!response.ok) throw new Error(`Transaction batch returned ${response.status}.`);
  const body = (await response.json()) as {id: number; result?: RawTransaction | null}[];
  if (!Array.isArray(body)) throw new Error("Transaction batch returned an unexpected body.");

  const out: ParsedTx[] = [];
  for (const item of body) {
    const signature = signatures[item.id];
    if (!item.result || !signature) continue;
    const parsed = toParsed(item.result, signature);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** The node to read raw transactions from, or null when none is configured. */
export const rawRpc = (): string | null => process.env.SOLANA_RPC_URL || null;

/** Read and reduce transactions, every batch at once. */
export async function rawTransactions(signatures: string[]): Promise<ParsedTx[]> {
  const rpc = rawRpc();
  if (!rpc) throw new Error("No RPC is configured for raw transactions.");
  const batches: string[][] = [];
  for (let i = 0; i < signatures.length; i += BATCH) batches.push(signatures.slice(i, i + BATCH));
  return (await Promise.all(batches.map((signatures) => batch(rpc, signatures)))).flat();
}
