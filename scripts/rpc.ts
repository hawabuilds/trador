/**
 * Shared JSON-RPC and census helpers for the probe and sync scripts.
 *
 * Dependency-free on purpose: these scripts have to run before `npm install`
 * succeeds, because what they find is what decides which SDKs are worth
 * installing at all.
 */

import {LAUNCHPAD_POOL, RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {type Pubkey, readPubkeyAt} from "@/lib/pubkey";

export const RPC_URL =
  process.env.HELIUS_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

export function redactedRpcUrl(): string {
  return RPC_URL.replace(/api[-_]?key=[^&]+/i, "api-key=***");
}

let calls = 0;
export const rpcCallCount = (): number => calls;

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  calls += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: calls, method, params}),
  });
  if (!response.ok) {
    throw new Error(`${method} → HTTP ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as {result?: T; error?: {message: string; code: number}};
  if (body.error) throw new Error(`${method} → ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

// ---------------------------------------------------------------------------
// Pool census
// ---------------------------------------------------------------------------

export interface PoolPair {
  pool: Pubkey;
  mintA: Pubkey;
  mintB: Pubkey;
  platform: string;
}

/**
 * Read both mints out of every pool for one platform.
 *
 * `dataSlice` is what makes this affordable: 64 bytes per pool instead of 429,
 * across tens of thousands of pools. Offsets in the returned buffer are
 * relative to the slice, so mintA lands at 0 and mintB at 32.
 */
export async function poolPairsFor(platformId: Pubkey, kind: string): Promise<PoolPair[]> {
  const accounts = await rpc<{pubkey: string; account: {data: [string, string]}}[]>(
    "getProgramAccounts",
    [
      RAYDIUM_LAUNCHPAD,
      {
        encoding: "base64",
        commitment: "confirmed",
        dataSlice: {offset: LAUNCHPAD_POOL.MINT_A, length: 64},
        filters: [
          {dataSize: LAUNCHPAD_POOL.SPAN},
          {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platformId}},
        ],
      },
    ],
  );

  const pairs: PoolPair[] = [];
  for (const entry of accounts) {
    const data = base64ToBytes(entry.account.data[0]);
    if (data.length < 64) continue;
    const mintA = readPubkeyAt(data, 0);
    const mintB = readPubkeyAt(data, 32);
    const pool = entry.pubkey as Pubkey;
    if (mintA && mintB) pairs.push({pool, mintA, mintB, platform: kind});
  }
  return pairs;
}

export async function allStonkfunPools(
  onProgress?: (kind: string, count: number) => void,
): Promise<PoolPair[]> {
  const all: PoolPair[] = [];
  for (const platform of STONKFUN_PLATFORMS) {
    const pairs = await poolPairsFor(platform.platformId, platform.kind);
    onProgress?.(platform.kind, pairs.length);
    all.push(...pairs);
  }
  return all;
}

export interface QuoteCount {
  mint: Pubkey;
  asQuote: number;
  asBase: number;
}

/**
 * Rank mints by how many launches price against them.
 *
 * A launched coin sits on the quote side of at most a handful of pools; a quote
 * asset sits there hundreds or thousands of times. The threshold separates the
 * two populations without needing to know in advance which mint is which —
 * which is the whole point, since knowing in advance is what tempts you into
 * copying addresses out of a blog post.
 */
export function rankQuoteAssets(pairs: PoolPair[], minLaunches = 3): QuoteCount[] {
  const counts = new Map<string, QuoteCount>();
  for (const pair of pairs) {
    for (const [mint, side] of [
      [pair.mintA, "asBase"],
      [pair.mintB, "asQuote"],
    ] as const) {
      const row = counts.get(mint) ?? {mint, asQuote: 0, asBase: 0};
      row[side] += 1;
      counts.set(mint, row);
    }
  }
  return [...counts.values()]
    .filter((row) => row.asQuote >= minLaunches)
    .sort((a, b) => b.asQuote - a.asQuote);
}

// ---------------------------------------------------------------------------
// Mint accounts
// ---------------------------------------------------------------------------

export interface MintAccount {
  mint: Pubkey;
  decimals: number;
  supply: string;
  /** Owning SPL program — classic or Token-2022. Never assume. */
  tokenProgram: Pubkey;
  mintAuthority: Pubkey | null;
  freezeAuthority: Pubkey | null;
}

export async function mintAccounts(mints: Pubkey[]): Promise<Map<string, MintAccount>> {
  const out = new Map<string, MintAccount>();

  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const result = await rpc<{
      value: ({owner: string; data: {parsed?: {info?: Record<string, unknown>}}} | null)[];
    }>("getMultipleAccounts", [batch, {encoding: "jsonParsed", commitment: "confirmed"}]);

    result.value.forEach((account, index) => {
      if (!account) return;
      const info = account.data?.parsed?.info ?? {};
      out.set(batch[index], {
        mint: batch[index],
        decimals: Number(info.decimals ?? 0),
        supply: String(info.supply ?? "0"),
        tokenProgram: account.owner as Pubkey,
        mintAuthority: (info.mintAuthority as string | null) as Pubkey | null,
        freezeAuthority: (info.freezeAuthority as string | null) as Pubkey | null,
      });
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Token identity
// ---------------------------------------------------------------------------

export interface TokenIdentity {
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * Resolve a mint's symbol and name.
 *
 * Jupiter's token API rather than Metaplex metadata PDAs, because deriving a
 * PDA off-chain needs curve arithmetic these scripts deliberately have no
 * dependency for. This is used for *labels only* — the issuer claim is proved
 * from the mint authority, never from a name a third party reports.
 */
export async function tokenIdentities(
  mints: Pubkey[],
): Promise<Map<string, TokenIdentity>> {
  const out = new Map<string, TokenIdentity>();

  for (const mint of mints) {
    try {
      const response = await fetch(
        `https://lite-api.jup.ag/tokens/v2/search?query=${mint}`,
      );
      if (!response.ok) continue;
      const body = (await response.json()) as unknown;
      const rows = Array.isArray(body)
        ? body
        : ((body as {tokens?: unknown[]}).tokens ?? []);
      const match = (rows as {id?: string; symbol?: string; name?: string; decimals?: number}[]).find(
        (row) => row.id === mint,
      );
      if (match?.symbol) {
        out.set(mint, {
          symbol: match.symbol,
          name: match.name ?? match.symbol,
          decimals: Number(match.decimals ?? 0),
        });
      }
    } catch {
      // A label we cannot resolve is not fatal; the mint authority is.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return out;
}
