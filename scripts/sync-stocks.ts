/**
 * Build the tokenized-stock registry from what is actually on chain.
 *
 * The registry decides which coins are allowed to claim a stock pairing, so how
 * it gets filled matters more than how big it is. Copying mint addresses out of
 * an article is the cheap way and the wrong one — a fabricated address is
 * trivial to publish and nearly impossible to disprove by eye, and once one is
 * in, any coin paired against it inherits a real asset's credibility.
 *
 * So this derives the list instead:
 *
 *   1. Census every StonkFun pool and rank mints by how many launches price
 *      against them. Quote assets appear hundreds of times; launched coins
 *      appear once or twice. No prior knowledge of which mint is which.
 *   2. Read each candidate's mint account for decimals, owning SPL program and
 *      **mint authority**.
 *   3. Group by authority. An issuer mints its whole range from one authority,
 *      so the families fall out of the data rather than being asserted.
 *   4. Only a family whose authority is recognised below becomes a stock. A
 *      symbol that merely looks like a ticker proves nothing.
 *
 * Labels (symbol, name) come from a token API and are cosmetic. The issuer
 * claim rests entirely on the authority.
 *
 *   npm run sync:stocks            report families, write nothing
 *   npm run sync:stocks -- --write update mints.generated.json
 */

import {writeFileSync} from "node:fs";
import path from "node:path";

import {type Pubkey} from "@/lib/pubkey";
import {
  allStonkfunPools,
  mintAccounts,
  rankQuoteAssets,
  redactedRpcUrl,
  rpcCallCount,
  tokenIdentities,
} from "./rpc";

export type StockKind = "equity" | "etf" | "pre-ipo" | "commodity";

/**
 * Mint authorities that identify a tokenized-stock issuer.
 *
 * Each was found by running this script in report mode: census the pools, group
 * the quote assets by mint authority, and read which families are one issuer's
 * range rather than a grab-bag. Both entries below are a single authority
 * minting a coherent set of equities at a single decimal count.
 *
 * Two findings from that run are the reason this file checks authorities rather
 * than names or address prefixes:
 *
 *   - `xSOL` ("Hylo Leveraged SOL", 718 launches) would pass any prefix rule
 *     aimed at xStocks. It is a leveraged SOL derivative, not an equity.
 *   - `tOpenAI` ("T-OpenAI") sits in the census next to PreStocks' `OPENAI`,
 *     with a different authority. Two tokens, both offering OpenAI exposure,
 *     one issuer verified and one not. A name check cannot tell them apart; the
 *     authority does, immediately.
 */
const ISSUER_AUTHORITIES: Record<string, {issuer: string; label: string}> = {
  // 23 mints, all 8 decimals, all Xs-prefixed: NVDAx, SPYx, SPCXx, AAPLx,
  // HOODx, MCDx, GLDx, MSFTx, QQQx, TSLAx, GOOGLx, GMEx, METAx, COINx…
  "7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj": {
    issuer: "backed",
    label: "xStocks (Backed Finance)",
  },
  // 6 mints, all 9 decimals, all Pre-prefixed: OPENAI, ANTHROPIC, POLYMARKET,
  // NEURALINK, KALSHI, ANDURIL.
  "WV9PJN7XTmTLVwbutCLFxp8TyePee6Xq5mRq6Fti5Wc": {
    issuer: "prestocks",
    label: "PreStocks (pre-IPO)",
  },
};

/**
 * Backpack Securities — a real third family, deliberately not enabled.
 *
 * Their tokenized equities (NKE, DKNG, GRND, DJT, RDDT, TTWO, SPHR…) carry
 * roughly three thousand launches between them, so this is not a rounding
 * error. But unlike Backed and PreStocks, each Backpack mint has its **own**
 * mint authority, so there is no single key that proves the family. Admitting
 * them means maintaining a per-mint allowlist, which is a weaker guarantee and
 * a standing obligation.
 *
 * Turning this on is a product decision rather than a technical one, so it is
 * one line and a review of the emitted diff — not a silent default.
 */
const INCLUDE_BACKPACK = process.env.INCLUDE_BACKPACK === "1";

const BACKPACK_MINTS: Record<string, string> = {
  NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg: "5tPguepcKacsBPHrbWXr8Zo8A3osVKzLG65y697SvKTh",
  GRNDYDpqwpCm6jVxpbh4xT5AM4r3p391qYsKTHqgaET2: "EfB3iMswBzLBrVamjRHqPMKzvu7fyYsuLY1zu9fiPGFY",
  DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow: "mHRjfhQqbuPZcHk1YSoNSQmZWFqj2Yc3om1UTQgQJef",
};

/**
 * What kind of asset a verified mint represents.
 *
 * Derived from the issuer plus the resolved name, because the distinction is
 * real to a user: an index fund, a bar of gold and a share of Apple behave
 * differently, and a pre-IPO name has no public market at all.
 */
function kindFor(issuer: string, symbol: string, name: string): StockKind {
  if (issuer === "prestocks") return "pre-ipo";
  const text = `${symbol} ${name}`.toLowerCase(); // pubkey-lint-ok: label text, not an address
  if (/\b(gold|silver|platinum|oil|copper)\b/.test(text)) return "commodity";
  if (/\b(sp500|s&p|nasdaq|etf|index|russell|dow)\b/.test(text)) return "etf";
  return "equity";
}

interface GeneratedStock {
  ticker: string;
  name: string;
  mint: Pubkey;
  decimals: number;
  tokenProgram: Pubkey;
  issuer: string;
  kind: StockKind;
  priceAuthority: "pyth" | "none";
  launchesQuotedAgainst: number;
  verified: {
    mintAuthority: Pubkey | null;
    at: string;
    source: string;
  };
}

const WRITE = process.argv.includes("--write");
const OUT = path.join(process.cwd(), "src", "lib", "stocks", "mints.generated.json");

function heading(text: string): void {
  console.log(`\n${"─".repeat(76)}\n${text}\n${"─".repeat(76)}`);
}

async function main(): Promise<void> {
  console.log("Trador stock registry sync");
  console.log(`RPC  ${redactedRpcUrl()}`);
  console.log(WRITE ? "mode: WRITE\n" : "mode: report only (pass --write to update)\n");

  const pools = await allStonkfunPools((kind, count) =>
    console.log(`  ${kind} launches: ${count} pools`),
  );

  if (pools.length === 0) {
    console.log("\nNo pools read. Set HELIUS_RPC_URL — public RPCs limit getProgramAccounts.");
    return;
  }

  const ranked = rankQuoteAssets(pools, 3).slice(0, 120);
  console.log(`\n  ${pools.length} pools → ${ranked.length} quote assets used by 3+ launches`);

  const accounts = await mintAccounts(ranked.map((row) => row.mint));
  const identities = await tokenIdentities(ranked.map((row) => row.mint));

  // ---------------------------------------------------------------------
  // Group by mint authority — the issuer families
  // ---------------------------------------------------------------------

  const families = new Map<
    string,
    {authority: string; members: {mint: Pubkey; symbol: string; name: string; decimals: number; launches: number}[]}
  >();

  for (const row of ranked) {
    const account = accounts.get(row.mint);
    if (!account) continue;
    const key = account.mintAuthority ?? "(none)";
    const family = families.get(key) ?? {authority: key, members: []};
    const identity = identities.get(row.mint);
    family.members.push({
      mint: row.mint,
      symbol: identity?.symbol ?? "?",
      name: identity?.name ?? "?",
      decimals: account.decimals,
      launches: row.asQuote,
    });
    families.set(key, family);
  }

  heading("Issuer families, by mint authority");

  const sorted = [...families.values()].sort((a, b) => b.members.length - a.members.length);

  for (const family of sorted) {
    const known = ISSUER_AUTHORITIES[family.authority];
    const total = family.members.reduce((sum, member) => sum + member.launches, 0);

    console.log(
      `\n  authority ${family.authority}` +
        `\n  ${family.members.length} mint(s), ${total} launches` +
        (known ? `  ✔ ${known.label}` : "  ⚠ unrecognised issuer"),
    );

    for (const member of family.members.slice(0, 14)) {
      console.log(
        `    ${String(member.launches).padStart(5)}  ${member.symbol.padEnd(10)} ` +
          `${String(member.decimals).padStart(2)}d  ${member.name.slice(0, 38).padEnd(40)} ${member.mint}`,
      );
    }
    if (family.members.length > 14) {
      console.log(`    … ${family.members.length - 14} more`);
    }
  }

  // ---------------------------------------------------------------------
  // Emit only recognised families
  // ---------------------------------------------------------------------

  const stocks: GeneratedStock[] = [];
  const now = new Date().toISOString();

  for (const family of sorted) {
    for (const member of family.members) {
      const account = accounts.get(member.mint)!;

      // An issuer-wide authority is the strong case: one key mints the whole
      // range, so membership is proved by a single comparison.
      const byAuthority = ISSUER_AUTHORITIES[family.authority];

      // Backpack is the weak case: the authority is per-mint, so the mint has
      // to be named *and* its authority has to still match what was recorded.
      // If they ever rotate a key, this drops the entry rather than trusting a
      // stale allowlist.
      const backpackAuthority = BACKPACK_MINTS[member.mint];
      const byAllowlist =
        INCLUDE_BACKPACK &&
        backpackAuthority !== undefined &&
        account.mintAuthority === backpackAuthority;

      if (!byAuthority && !byAllowlist) continue;

      const issuer = byAuthority?.issuer ?? "backpack";
      const kind = kindFor(issuer, member.symbol, member.name);

      stocks.push({
        ticker: member.symbol,
        name: member.name,
        mint: member.mint,
        decimals: account.decimals,
        tokenProgram: account.tokenProgram,
        issuer,
        kind,
        // A pre-IPO company has no listed equity, so no oracle can be
        // authoritative about it. Saying so is the honest option; inventing a
        // price from a thin pool is not.
        priceAuthority: kind === "pre-ipo" ? "none" : "pyth",
        launchesQuotedAgainst: member.launches,
        verified: {
          mintAuthority: account.mintAuthority,
          at: now,
          source: byAuthority
            ? "issuer mint authority + stonkfun pool census"
            : "per-mint allowlist + mint authority match",
        },
      });
    }
  }

  stocks.sort((a, b) => b.launchesQuotedAgainst - a.launchesQuotedAgainst);

  heading("Result");

  if (Object.keys(ISSUER_AUTHORITIES).length === 0) {
    console.log(
      "  No issuer authorities are recognised yet, so nothing was emitted.\n\n" +
        "  Read the families above. A family that is one issuer's range — a set\n" +
        "  of equity tickers sharing one authority and one decimal count — goes\n" +
        "  into ISSUER_AUTHORITIES in this file. Then rerun with --write.\n\n" +
        "  Do not add a family because its symbols look like tickers. Anyone can\n" +
        "  mint a token called NVDA.",
    );
  } else {
    console.log(`  ${stocks.length} verified stock mint(s) across ` +
      `${new Set(stocks.map((s) => s.issuer)).size} issuer(s)`);

    if (WRITE) {
      writeFileSync(OUT, `${JSON.stringify(stocks, null, 2)}\n`, "utf8");
      console.log(`  written → ${path.relative(process.cwd(), OUT)}`);
      console.log("  Review the diff before committing. This file is a trust boundary.");
    } else {
      console.log("  Pass --write to update mints.generated.json.");
    }
  }

  console.log(`\n  ${rpcCallCount()} RPC calls.\n`);
}

main().catch((error) => {
  console.error(`\nsync failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
