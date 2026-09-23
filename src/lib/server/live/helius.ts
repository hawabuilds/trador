/**
 * Helius, for parsed transactions.
 *
 * Shared by the pool tape and the wallet history. Parsed transactions are the
 * expensive tier, so both callers find signatures with a plain RPC call first
 * and only parse what they have not seen.
 */

import type {Pubkey} from "@/lib/pubkey";

export const HELIUS_API = process.env.HELIUS_API_URL ?? "https://api-mainnet.helius-rpc.com";

/** Parsed transactions are requested at most this many at a time. */
export const PARSE_BATCH = 100;

export function heliusKey(): string | null {
  if (process.env.HELIUS_API_KEY) return process.env.HELIUS_API_KEY;
  const rpc = process.env.HELIUS_RPC_URL;
  if (!rpc) return null;
  try {
    return new URL(rpc).searchParams.get("api-key");
  } catch {
    return null;
  }
}

export interface TokenBalanceChange {
  userAccount: string;
  tokenAccount: string;
  mint: string;
  rawTokenAmount: {tokenAmount: string; decimals: number};
}

export interface ParsedInstruction {
  programId: string;
  accounts: string[];
  /** Base58 instruction data. */
  data?: string;
  innerInstructions?: Omit<ParsedInstruction, "innerInstructions">[];
}

/** The subset of a Helius parsed transaction this app reads. */
export interface ParsedTx {
  instructions?: ParsedInstruction[];
  signature: string;
  timestamp: number;
  feePayer: string;
  /** Lamports, priority fee included. */
  fee?: number;
  transactionError?: unknown;
  accountData?: {
    account?: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: TokenBalanceChange[];
  }[];
}

export const uiAmount = (raw: {tokenAmount: string; decimals: number}): number =>
  Number(raw.tokenAmount) / 10 ** raw.decimals;

export async function asParsed(response: Response): Promise<ParsedTx[]> {
  if (!response.ok) throw new Error(`Helius returned ${response.status}.`);
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("Helius returned an unexpected body.");
  return body as ParsedTx[];
}

/** Parse up to `PARSE_BATCH` signatures in one call. */
export async function parseTransactions(signatures: string[], key: string): Promise<ParsedTx[]> {
  if (signatures.length === 0) return [];
  return asParsed(
    await fetch(`${HELIUS_API}/v0/transactions?api-key=${key}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      cache: "no-store",
      body: JSON.stringify({transactions: signatures}),
    }),
  );
}

/** A newest-first page of parsed transactions touching an address. */
export async function addressPage(
  address: Pubkey,
  key: string,
  limit: number,
  before?: string,
): Promise<ParsedTx[]> {
  const url =
    `${HELIUS_API}/v0/addresses/${address}/transactions?api-key=${key}&limit=${limit}` +
    (before ? `&before=${before}` : "");
  return asParsed(await fetch(url, {cache: "no-store"}));
}

export interface SignatureRow {
  signature: string;
  err: unknown;
  blockTime: number | null;
}

/**
 * Signatures touching an address, newest first — a plain RPC call.
 *
 * `until` stops at a signature already processed; `before` pages backwards.
 */
export async function signaturesFor(
  address: Pubkey,
  options: {until?: string; before?: string; limit: number},
): Promise<SignatureRow[]> {
  /*
   * The plain node first, Helius second.
   *
   * Helius answers these about twice as fast (0.09s against 0.19s), and that
   * is how this was ordered — but its rate limit counts these lists against
   * everything else, and the worker asks for one per coin per round. It began
   * refusing a third of them, which is a tape that stops updating; the other
   * node took forty at once without refusing any. Helius is the fallback,
   * which is what this ordering is for.
   */
  const rpcs = [
    process.env.RAW_TX_RPC_URL,
    "https://api.mainnet-beta.solana.com",
    process.env.HELIUS_RPC_URL,
  ].filter(
    (url, index, all): url is string => Boolean(url) && all.indexOf(url) === index,
  );
  if (rpcs.length === 0) throw new Error("No RPC is configured.");

  let lastError = "Signature list failed.";
  for (const rpc of rpcs) {
    const response = await fetch(rpc, {
      method: "POST",
      headers: {"content-type": "application/json"},
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [address, {...options, commitment: "confirmed"}],
      }),
    });
    if (response.status === 429) {
      lastError = "Signature list was rate limited.";
      continue;
    }
    const body = (await response.json()) as {result?: SignatureRow[]; error?: {message: string}};
    if (!response.ok || body.error || !body.result) {
      throw new Error(body.error?.message ?? `Signature list returned ${response.status}.`);
    }
    return body.result;
  }
  throw new Error(lastError);
}
