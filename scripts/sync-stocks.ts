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

import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

import {type Pubkey} from "@/lib/pubkey";
import {
  allStonkfunPools,
  mintAccounts,
  type MintAccount,
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
 * Backpack Securities — proved by a control key, not by an allowlist.
 *
 * This family used to be gated behind `INCLUDE_BACKPACK=1` and a hand-written
 * list of three mints, on the reasoning that every Backpack mint carries its
 * own mint authority so nothing could prove the family. The first half of that
 * is true; the conclusion was not. All of their mints share **one** key across
 * three independent fields at once — the freeze authority, the Token-2022
 * metadata update authority, and the permanent delegate.
 *
 * That is a stronger claim than the mint-authority test used for Backed and
 * PreStocks, not a weaker one: an impostor would have to control the freeze
 * authority, the metadata and the permanent delegate of its fake mint *and*
 * set all three to Backpack's key, which would hand Backpack the power to
 * freeze and claw back the impostor's own supply.
 *
 * Requiring all three to agree is what makes it safe to drop the allowlist.
 * Any single one of them could be set to a key the setter does not control.
 */
const CONTROL_AUTHORITIES: Record<string, {issuer: string; label: string}> = {
  // 37 mints and counting, all Token-2022, all 6 decimals: NKE, DKNG, GRND,
  // TTWO, RDDT, DJT, HTZ, SPHR, RBLX, WEN…
  "2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a": {
    issuer: "backpack",
    label: "Backpack Securities",
  },
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
    /** As read off the mint. Per-mint for some issuers, so not proof alone. */
    mintAuthority: Pubkey | null;
    /** The key that proved the family, and which field carried it. */
    issuerKey: Pubkey | null;
    via: "mint-authority" | "control-authority";
    at: string;
    source: string;
  };
}

const WRITE = process.argv.includes("--write");
/** Allows a write that would shrink the registry. See the refusal below. */
const FORCE = process.argv.includes("--force");
const OUT = path.join(process.cwd(), "src", "lib", "stocks", "mints.generated.json");

/** How many stocks the registry holds today, or null if it has never been written. */
function readExistingCount(): number | null {
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf8")) as unknown[];
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function heading(text: string): void {
  console.log(`\n${"─".repeat(76)}\n${text}\n${"─".repeat(76)}`);
}

/**
 * The issuer a mint's *control* key proves, if any.
 *
 * All three fields must name the same recognised key. Any one of them alone
 * could be set to a key the setter does not hold; requiring the freeze
 * authority, the metadata update authority and the permanent delegate to agree
 * means faking it would hand that issuer the power to freeze and claw back the
 * impostor's own supply.
 */
function controlIssuerFor(
  account: MintAccount | undefined,
): {issuer: string; label: string} | undefined {
  if (!account) return undefined;
  const key = account.freezeAuthority;
  if (key === null) return undefined;
  if (account.updateAuthority !== key || account.permanentDelegate !== key) {
    return undefined;
  }
  return CONTROL_AUTHORITIES[key];
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

    /*
     * A control-authority issuer mints each stock from its own key, so its
     * range is scattered across dozens of one-member "families" in this
     * listing. Calling those `unrecognised` while the emit step accepts them
     * makes the listing actively misleading — and this listing is the human
     * review the whole script leans on.
     */
    const control = controlIssuerFor(accounts.get(family.members[0].mint));
    const viaControl =
      control !== undefined &&
      family.members.every(
        (member) => controlIssuerFor(accounts.get(member.mint))?.issuer === control.issuer,
      );

    console.log(
      `\n  authority ${family.authority}` +
        `\n  ${family.members.length} mint(s), ${total} launches` +
        (known
          ? `  ✔ ${known.label}`
          : viaControl
            ? `  ✔ ${control.label} (by control key)`
            : "  ⚠ unrecognised issuer"),
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
  const unresolved: Pubkey[] = [];
  const now = new Date().toISOString();

  for (const family of sorted) {
    for (const member of family.members) {
      const account = accounts.get(member.mint)!;

      // One key mints the whole range. Membership is a single comparison.
      const byAuthority = ISSUER_AUTHORITIES[family.authority];

      /*
       * Or: one key *controls* the whole range, which some issuers use instead.
       * All three fields must agree and must name the same recognised key —
       * see CONTROL_AUTHORITIES. Any one of them alone could be set to a key
       * the setter does not control.
       */
      const byControl = controlIssuerFor(account);

      if (!byAuthority && !byControl) continue;

      /*
       * A verified mint with no resolved label is not a registry entry.
       *
       * The registry is keyed and routed by ticker, so `"?"` is not a cosmetic
       * gap — it is an entry nothing can look up and a URL nobody can reach.
       * An earlier run wrote all 57 entries with `ticker: "?"` because the
       * label provider had rate-limited every request, and reported "57
       * verified stock mint(s)" without a word about it. Collected here and
       * refused below, rather than written and discovered later.
       */
      if (member.symbol === "?" || member.name === "?") {
        unresolved.push(member.mint);
        continue;
      }

      const issuer = (byAuthority ?? byControl)!.issuer;
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
          /*
           * The key that actually proved the family, and how. Recorded
           * separately because for a control-authority issuer the mint
           * authority above is per-mint and proves nothing on its own —
           * writing it into a field called "verified" without this would read
           * as evidence it is not.
           */
          issuerKey: byAuthority ? family.authority : account.freezeAuthority,
          via: byAuthority ? "mint-authority" : "control-authority",
          at: now,
          source: byAuthority
            ? "issuer mint authority + stonkfun pool census"
            : "issuer control key (freeze + metadata + permanent delegate) + stonkfun pool census",
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

    if (unresolved.length > 0) {
      console.log(
        `\n  ${unresolved.length} verified mint(s) had no resolvable ticker and ` +
          `were left out:\n    ${unresolved.slice(0, 8).join("\n    ")}` +
          (unresolved.length > 8 ? `\n    … ${unresolved.length - 8} more` : ""),
      );
    }

    /*
     * Refuse to shrink the registry on a bad run.
     *
     * The label provider rate-limits, and when it does every mint comes back
     * unresolved — which is indistinguishable, at the point of writing, from
     * an issuer genuinely delisting its whole range. One is a transient
     * network condition and the other has never happened. Writing a smaller
     * file on a throttled run silently deletes stocks from the app, and the
     * only symptom is coins quietly leaving the feed.
     *
     * `--force` exists for the real case, where a shrink is intended.
     */
    const existing = readExistingCount();
    const shrank = existing !== null && stocks.length < existing;

    if (WRITE && shrank && !FORCE) {
      console.log(
        `\n  REFUSED to write: this run produced ${stocks.length} stock(s) but the ` +
          `registry\n  already holds ${existing}. That is usually the label provider ` +
          `rate-limiting,\n  not an issuer delisting its range — check the warnings above.\n\n` +
          `  Rerun when it is healthy, or pass --force if the shrink is intended.`,
      );
    } else if (WRITE) {
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
