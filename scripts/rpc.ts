/**
 * Shared JSON-RPC and census helpers for the probe and sync scripts.
 *
 * Dependency-free on purpose: these scripts have to run before `npm install`
 * succeeds, because what they find is what decides which SDKs are worth
 * installing at all.
 */

import {LAUNCHPAD_POOL, RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {CLMM_MINTS_SLICE, CLMM_POOL, stonkfunClmmFilters} from "@/lib/launchpad/stonkfunClmm";
import {type Pubkey, readPubkeyAt} from "@/lib/pubkey";
import {indexerRpcUrl} from "@/lib/server/rpcUrl";

/** Census scripts are indexer-scale; use the same URL priority as the worker. */
export const RPC_URL = indexerRpcUrl();

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

  const clmm = await clmmPoolPairs();
  onProgress?.("clmm (direct)", clmm.length / 2);
  all.push(...clmm);

  return all;
}

/**
 * StonkFun's direct CLMM launches, as census rows.
 *
 * Without these the census only saw stocks that curve launches price against,
 * and VIDAx — quoted by 23 direct launches and no curve launch at all — never
 * reached the registry, so every coin priced in it failed the universe test.
 *
 * A CLMM pool orders its two mints by address, not by base and quote, so each
 * pool is emitted twice with the sides swapped. That counts both mints once as
 * a quote. A launched coin then appears once and stays under the ranking
 * threshold, while a stock appears as often as it is used — and nothing is
 * admitted on a count anyway: a candidate still needs a recognised issuer key.
 */
export async function clmmPoolPairs(): Promise<PoolPair[]> {
  const accounts = await rpc<{pubkey: string; account: {data: [string, string]}}[]>(
    "getProgramAccounts",
    [
      CLMM_POOL.PROGRAM,
      {
        encoding: "base64",
        commitment: "confirmed",
        dataSlice: CLMM_MINTS_SLICE,
        filters: stonkfunClmmFilters(),
      },
    ],
  );

  const pairs: PoolPair[] = [];
  for (const entry of accounts) {
    const data = base64ToBytes(entry.account.data[0]);
    const mint0 = readPubkeyAt(data, 0);
    const mint1 = readPubkeyAt(data, 32);
    const pool = entry.pubkey as Pubkey;
    if (!mint0 || !mint1) continue;
    pairs.push({pool, mintA: mint0, mintB: mint1, platform: "clmm"});
    pairs.push({pool, mintA: mint1, mintB: mint0, platform: "clmm"});
  }
  return pairs;
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
  /**
   * Token-2022 metadata update authority, and the permanent delegate.
   *
   * Read because the mint authority is not always where an issuer's identity
   * lives. Backed and PreStocks mint their whole range from one key, so
   * grouping by `mintAuthority` finds those families exactly. Backpack
   * Securities does not: every one of its mints has its own mint authority, and
   * for a long time that was taken to mean the family could not be proved at
   * all. It can — all three of these fields carry the same issuer key on every
   * Backpack mint, which is a stronger signal than any one of them alone.
   */
  updateAuthority: Pubkey | null;
  permanentDelegate: Pubkey | null;
  /** Token-2022 on-chain metadata, when the mint carries that extension. */
  onChainSymbol: string | null;
  onChainName: string | null;
  /**
   * Token-2022 transfer fee, in basis points, or null when the mint has none.
   *
   * Read because it is a real cost the app would otherwise hide: it is taken
   * on every transfer, including each leg of a swap. Measured rather than
   * assumed, and the measurement was a surprise — all five PreStocks mints
   * charge 50bps and Tessera charges 20, while Backed and Backpack charge
   * nothing. The app had been quoting PreStocks as free for as long as they
   * had been listed.
   */
  transferFeeBps: number | null;
}

/**
 * The fee currently in force, preferring the newer schedule.
 *
 * Token-2022 keeps two: `older` applies up to an epoch and `newer` after it.
 * Reading the older one reports a rate that may already have been replaced.
 */
function readTransferFeeBps(config: Record<string, unknown> | undefined): number | null {
  if (!config) return null;
  const schedule = (config.newerTransferFee ?? config.olderTransferFee) as
    | {transferFeeBasisPoints?: number}
    | undefined;
  const bps = schedule?.transferFeeBasisPoints;
  return typeof bps === "number" ? bps : null;
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
      const extensions = (info.extensions ?? []) as {
        extension?: string;
        state?: Record<string, unknown>;
      }[];
      const extension = (name: string): Record<string, unknown> | undefined =>
        extensions.find((entry) => entry.extension === name)?.state;

      const tokenMetadata = extension("tokenMetadata");
      out.set(batch[index], {
        mint: batch[index],
        decimals: Number(info.decimals ?? 0),
        supply: String(info.supply ?? "0"),
        tokenProgram: account.owner as Pubkey,
        mintAuthority: (info.mintAuthority as string | null) as Pubkey | null,
        freezeAuthority: (info.freezeAuthority as string | null) as Pubkey | null,
        updateAuthority: (tokenMetadata?.updateAuthority as Pubkey | undefined) ?? null,
        permanentDelegate:
          (extension("permanentDelegate")?.delegate as Pubkey | undefined) ?? null,
        onChainSymbol: (tokenMetadata?.symbol as string | undefined) ?? null,
        onChainName: (tokenMetadata?.name as string | undefined) ?? null,
        transferFeeBps: readTransferFeeBps(extension("transferFeeConfig")),
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

  /*
   * Batched, because one request per mint does not survive contact with the
   * rate limit.
   *
   * This used to loop mint-by-mint with a 120ms pause. At ~120 quote assets
   * that is two minutes of requests, and Jupiter's lite tier throttles long
   * before the end — every throttled response hit `if (!response.ok) continue`
   * and was dropped silently. The visible result was a registry where all 57
   * entries had "?" for ticker and name, written without a single warning.
   *
   * The search endpoint takes a comma list, so twenty at a time is six
   * requests instead of a hundred and twenty.
   */
  const BATCH = 20;

  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);

    try {
      const response = await fetch(
        `https://lite-api.jup.ag/tokens/v2/search?query=${batch.join(",")}`,
      );
      if (!response.ok) {
        // Surfaced, not swallowed. The caller decides whether a missing label
        // is fatal; it cannot decide that if it never hears about it.
        console.warn(`  token identities: batch ${i / BATCH + 1} -> ${response.status}`);
        continue;
      }

      const body = (await response.json()) as unknown;
      const rows = Array.isArray(body)
        ? body
        : ((body as {tokens?: unknown[]}).tokens ?? []);

      for (const row of rows as {
        id?: string;
        symbol?: string;
        name?: string;
        decimals?: number;
      }[]) {
        if (!row.id || !row.symbol) continue;
        out.set(row.id, {
          symbol: row.symbol,
          name: row.name ?? row.symbol,
          decimals: Number(row.decimals ?? 0),
        });
      }
    } catch (error) {
      console.warn(`  token identities: batch ${i / BATCH + 1} failed — ${(error as Error).message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Issuer ranges
// ---------------------------------------------------------------------------

/**
 * Every mint an authority controls, via Helius DAS.
 *
 * The pool census can only find stocks that StonkFun launches already quote
 * against, which makes the registry a function of what the launchpad happens to
 * be popular with rather than of what an issuer actually offers. Tessera showed
 * the gap concretely: `tOpenAI` has 412 launches and sailed in, while `tSpaceX`
 * and `tKalshi` — same authority, same range, same everything — were invisible,
 * so a coin paired against either would have failed the universe test for no
 * reason but obscurity.
 *
 * This closes it. Once an authority is recognised, its whole range is admitted
 * rather than the subset one launchpad happens to trade. That also means a
 * stock quoted only on pump.fun, or not yet quoted anywhere, is still listed
 * and still searchable.
 *
 * Returns an empty list when the provider has no DAS endpoint, which degrades
 * to exactly the old census-only behaviour rather than failing the sync.
 */
function dasRpcUrl(): string | undefined {
  const helius = process.env.HELIUS_RPC_URL?.trim();
  if (helius) return helius;
  const indexer = process.env.INDEXER_RPC_URL?.trim();
  if (indexer) return indexer;
  return undefined;
}

/** DAS-only JSON-RPC — never routes through the census RPC. */
async function dasRpc<T>(method: string, params: unknown): Promise<T> {
  const url = dasRpcUrl();
  if (!url) throw new Error("no HELIUS_RPC_URL or INDEXER_RPC_URL for DAS");
  calls += 1;
  const response = await fetch(url, {
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

export async function assetsByAuthority(authority: string): Promise<Pubkey[]> {
  const mints: Pubkey[] = [];

  for (let page = 1; page <= 10; page += 1) {
    let batch: {items?: {id?: string}[]; total?: number};

    try {
      batch = dasRpcUrl()
        ? await dasRpc<{items?: {id?: string}[]; total?: number}>("getAssetsByAuthority", {
            authorityAddress: authority,
            page,
            limit: 1000,
          })
        : await rpc<{items?: {id?: string}[]; total?: number}>("getAssetsByAuthority", {
            authorityAddress: authority,
            page,
            limit: 1000,
          });
    } catch (error) {
      console.warn(`  issuer range ${authority.slice(0, 8)}… -> ${(error as Error).message}`);
      return mints;
    }

    const items = batch.items ?? [];
    for (const item of items) {
      if (item.id) mints.push(item.id as Pubkey);
    }

    // A short page is the last page.
    if (items.length < 1000) break;
  }

  return mints;
}
