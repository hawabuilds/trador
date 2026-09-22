/**
 * Census every quote asset StonkFun launches actually pair against.
 *
 * This exists because the alternative is worse. The stock registry is the app's
 * trust boundary, and the tempting way to fill it is to copy mint addresses out
 * of a blog post or a token list — which is precisely how a fabricated address
 * gets in. Addresses that "look right" are cheap to produce and expensive to
 * disprove.
 *
 * So the list is derived instead of asserted: read the pools, tally what is on
 * the quote side, rank by how many launches use it. A mint that thousands of
 * real launches are priced against is a real quote asset, whatever any website
 * says. Verification of *which* stock it represents still needs the mint
 * account and its authority — that is `sync:stocks` — but this is how the
 * candidates are found honestly.
 *
 * `dataSlice` keeps it affordable: only the 64 bytes holding both mints are
 * fetched, not 429 bytes × 28k pools.
 *
 *   npm run probe:quotes
 */

import {LAUNCHPAD_POOL, RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {encodeBase58, readPubkeyAt} from "@/lib/pubkey";
import {stockForMint} from "@/lib/stocks/registry";

const RPC_URL =
  process.env.SOLANA_RPC_URL ||
  process.env.HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

let calls = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  calls += 1;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({jsonrpc: "2.0", id: calls, method, params}),
  });
  if (!response.ok) throw new Error(`${method} → HTTP ${response.status}`);
  const body = (await response.json()) as {result?: T; error?: {message: string}};
  if (body.error) throw new Error(`${method} → ${body.error.message}`);
  return body.result as T;
}

/**
 * Both mints in one slice.
 *
 * mintA is at 205 and mintB at 237, so 64 bytes from 205 covers the pair. The
 * slice is relative to the account, and the returned buffer is relative to the
 * slice — so mintA is at 0 and mintB at 32 in what comes back.
 */
const SLICE_OFFSET = LAUNCHPAD_POOL.MINT_A;
const SLICE_LENGTH = 64;

interface Sliced {
  pubkey: string;
  account: {data: [string, string]};
}

async function poolPairs(platformId: string): Promise<{pool: string; a: string; b: string}[]> {
  const accounts = await rpc<Sliced[]>("getProgramAccounts", [
    RAYDIUM_LAUNCHPAD,
    {
      encoding: "base64",
      commitment: "confirmed",
      dataSlice: {offset: SLICE_OFFSET, length: SLICE_LENGTH},
      filters: [
        {dataSize: LAUNCHPAD_POOL.SPAN},
        {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platformId}},
      ],
    },
  ]);

  const pairs: {pool: string; a: string; b: string}[] = [];
  for (const entry of accounts) {
    const data = Uint8Array.from(Buffer.from(entry.account.data[0], "base64"));
    if (data.length < SLICE_LENGTH) continue;
    const a = readPubkeyAt(data, 0);
    const b = readPubkeyAt(data, 32);
    if (a && b) pairs.push({pool: entry.pubkey, a, b});
  }
  return pairs;
}

interface MintRow {
  mint: string;
  asBase: number;
  asQuote: number;
  examplePool: string;
}

async function mintMetadata(
  mints: string[],
): Promise<Map<string, {decimals: number; supply: string; owner: string; authority: string | null}>> {
  const out = new Map<
    string,
    {decimals: number; supply: string; owner: string; authority: string | null}
  >();

  // 100 at a time is the usual getMultipleAccounts cap.
  for (let i = 0; i < mints.length; i += 100) {
    const batch = mints.slice(i, i + 100);
    const result = await rpc<{
      value: ({owner: string; data: {parsed?: {info?: Record<string, unknown>}}} | null)[];
    }>("getMultipleAccounts", [batch, {encoding: "jsonParsed", commitment: "confirmed"}]);

    result.value.forEach((account, index) => {
      if (!account) return;
      const info = account.data?.parsed?.info ?? {};
      out.set(batch[index], {
        decimals: Number(info.decimals ?? 0),
        supply: String(info.supply ?? "0"),
        owner: account.owner,
        authority: (info.mintAuthority as string | null) ?? null,
      });
    });
  }

  return out;
}

async function main(): Promise<void> {
  console.log("StonkFun quote-asset census");
  console.log(`RPC  ${RPC_URL.replace(/api[-_]?key=[^&]+/i, "api-key=***")}\n`);

  const counts = new Map<string, MintRow>();
  let totalPools = 0;

  for (const platform of STONKFUN_PLATFORMS) {
    process.stdout.write(`  reading ${platform.kind} launches… `);
    let pairs;
    try {
      pairs = await poolPairs(platform.platformId);
    } catch (error) {
      console.log(`failed: ${(error as Error).message}`);
      console.log("  → set HELIUS_RPC_URL; public RPCs limit getProgramAccounts.\n");
      continue;
    }
    console.log(`${pairs.length} pools`);
    totalPools += pairs.length;

    for (const pair of pairs) {
      for (const [mint, side] of [
        [pair.a, "asBase"],
        [pair.b, "asQuote"],
      ] as const) {
        const row = counts.get(mint) ?? {mint, asBase: 0, asQuote: 0, examplePool: pair.pool};
        row[side] += 1;
        counts.set(mint, row);
      }
    }
  }

  if (totalPools === 0) {
    console.log("No pools read. Nothing to report.");
    return;
  }

  /**
   * A quote asset is a mint many different launches price against. A launched
   * coin appears on the quote side of at most a handful of pools, so the
   * threshold separates the two populations cleanly without needing to know
   * which mint is which.
   */
  const candidates = [...counts.values()]
    .filter((row) => row.asQuote >= 3 || row.asBase >= 3)
    .sort((a, b) => b.asQuote + b.asBase - (a.asQuote + a.asBase))
    .slice(0, 60);

  console.log(
    `\n  ${totalPools} pools, ${counts.size} distinct mints, ` +
      `${candidates.length} used by 3+ launches\n`,
  );

  const metadata = await mintMetadata(candidates.map((row) => row.mint));

  console.log(
    "  quote  base   decimals  program   known      mint",
  );
  console.log(`  ${"─".repeat(94)}`);

  for (const row of candidates) {
    const meta = metadata.get(row.mint);
    const known = stockForMint(row.mint);
    const program = meta
      ? meta.owner.startsWith("TokenzQd")
        ? "token-2022"
        : meta.owner.startsWith("Tokenkeg")
          ? "spl-token"
          : "other"
      : "?";

    console.log(
      `  ${String(row.asQuote).padStart(5)}  ${String(row.asBase).padStart(5)}  ` +
        `${String(meta?.decimals ?? "?").padStart(8)}  ${program.padEnd(10)} ` +
        `${(known ? known.ticker : "").padEnd(10)} ${row.mint}`,
    );
  }

  console.log(
    "\n  Every row with a high `quote` count and no `known` ticker is a quote\n" +
      "  asset Trador does not recognise yet. Before any of them enters the\n" +
      "  registry, read its mint authority (the `program` and `decimals` above\n" +
      "  come from the account; the authority is what proves the issuer) and\n" +
      "  record it in the entry's `verified` block.\n" +
      `\n  ${calls} RPC calls.\n`,
  );
}

main().catch((error) => {
  console.error(`\ncensus failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
