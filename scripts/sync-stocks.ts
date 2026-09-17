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
  assetsByAuthority,
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
  /*
   * Tessera — 3 mints, all 9 decimals, all T-prefixed pre-IPO names: tOpenAI,
   * tSpaceX, tKalshi.
   *
   * `tOpenAI` used to be in this repo's known-lookalikes fixture, as the
   * example of why a name check cannot be trusted: it offers OpenAI exposure
   * from a different authority than PreStocks' OPENAI. That was the right
   * default and the wrong conclusion to leave standing. Absence from the
   * registry means "not yet verified", never "not real" — and this family
   * verifies cleanly. One key mints all three, updates all three metadata, and
   * a second key freezes all three, which is a tighter range than PreStocks'.
   *
   * They carry a 20bps transfer fee, unlike every other issuer here. That is
   * recorded per mint rather than per issuer, so nothing assumes it.
   */
  EXvTtxurWBUNNCtLojaN8ZBJFNJPZFSH3szoih9hh7YW: {
    issuer: "tessera",
    label: "Tessera (pre-IPO)",
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
 * Issues the issuer has taken out of service, and test mints.
 *
 * Reading an issuer's own lifecycle marker on a mint whose *identity* is
 * already proved by its authority. That is a different act from trusting a name
 * to establish identity, which this file refuses to do — the authority has
 * already answered "whose is this", and the label only answers "is it still
 * live", which nobody but the issuer can answer.
 *
 * Enumerating a range by authority surfaces everything the key ever minted,
 * including retired paper. PreStocks alone has 22 such mints — `[REFUNDED]
 * Databricks`, `[OUTDATED] SpaceX`, `[OUTDATED] OpenAI` beside the live OPENAI
 * — plus a mint literally called TEST carrying a 300bps fee. A coin paired to a
 * refunded instrument is paired to nothing, and the app would have shown it as
 * a verified stock pairing.
 */
function isRetired(symbol: string, name: string): boolean {
  const text = `${symbol} ${name}`.toLowerCase(); // pubkey-lint-ok: label text, not an address

  // Word-bounded. Without \b this also matched "Latest", "Protest", "Contest".
  if (/\b(refunded|outdated|deprecated|retired|migrated)\b/.test(text)) return true;

  // The symbol being exactly "TEST", not merely containing it — "ATEST" or a
  // company whose ticker ends in those letters is a real listing.
  return /^test$/i.test(symbol.trim());
}

/**
 * What kind of asset a verified mint represents.
 *
 * Derived from the issuer plus the resolved name, because the distinction is
 * real to a user: an index fund, a bar of gold and a share of Apple behave
 * differently, and a pre-IPO name has no public market at all.
 */
function kindFor(issuer: string, symbol: string, name: string): StockKind {
  // Both pre-IPO issuers: the underlying has no public listing at all.
  if (issuer === "prestocks" || issuer === "tessera") return "pre-ipo";
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
  /** On-chain transfer fee in bps, or null when the mint charges none. */
  transferFeeBps: number | null;
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

/** The registry as last written, or nothing if it has never been. */
function readExistingEntries(): {mint: string; launchesQuotedAgainst?: number}[] {
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf8")) as unknown;
    return Array.isArray(parsed)
      ? (parsed as {mint: string; launchesQuotedAgainst?: number}[])
      : [];
  } catch {
    return [];
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

  /*
   * Every quote asset with three or more launches, not the top 120.
   *
   * The cap was a cost guard, and it cut off a real stock: VIDAx sits at rank
   * 140 with 73 launches, so every coin priced in it failed the universe test.
   * The whole ranked list is a few hundred mints — a handful of batched calls —
   * and a long tail costs nothing in trust, because a candidate is admitted only
   * if a recognised issuer key minted or controls it.
   */
  const ranked = rankQuoteAssets(pools, 3);
  console.log(`\n  ${pools.length} pools → ${ranked.length} quote assets used by 3+ launches`);

  /*
   * Then the rest of each recognised issuer's range.
   *
   * The census only sees mints StonkFun already quotes, which makes the
   * registry a function of that launchpad's popularity rather than of what an
   * issuer offers. Tessera made the gap concrete: `tOpenAI` has 412 launches
   * and sailed in, while `tSpaceX` and `tKalshi` — same authority, same range,
   * same everything — were invisible, so a coin paired to either would have
   * failed the universe test for no reason but obscurity.
   *
   * Only for authorities already in the tables above. This widens a family that
   * has been verified; it never admits a new one.
   */
  const censused = new Set<string>(ranked.map((row) => row.mint));
  const extra: Pubkey[] = [];

  for (const [authority, issuer] of [
    ...Object.entries(ISSUER_AUTHORITIES),
    ...Object.entries(CONTROL_AUTHORITIES),
  ]) {
    const range = await assetsByAuthority(authority);
    const missing = range.filter((mint) => !censused.has(mint));
    if (missing.length > 0) {
      console.log(`  ${issuer.label}: +${missing.length} mint(s) not quoted on StonkFun`);
      for (const mint of missing) {
        censused.add(mint);
        extra.push(mint);
      }
    }
  }

  /*
   * And every mint already in the registry.
   *
   * Range completion rests on Helius's DAS index, which has both timed out and
   * returned an empty range for Backed's key with no error at all. Either way
   * the range members it would have listed dropped out of the candidates, the
   * result shrank from 82 to 61, and the only way past the shrink guard was
   * `--force` — which would have deleted 21 real stocks.
   *
   * Re-checking what is already registered removes that dependency without
   * loosening anything: these mints go through exactly the same on-chain
   * authority check as the rest, so a mint that no longer verifies still drops
   * out. What cannot happen any more is a stock disappearing because an index
   * had a bad hour.
   */
  for (const entry of readExistingEntries()) {
    if (censused.has(entry.mint)) continue;
    censused.add(entry.mint);
    extra.push(entry.mint as Pubkey);
  }

  const candidates = [...ranked.map((row) => row.mint), ...extra];
  const accounts = await mintAccounts(candidates);
  const identities = await tokenIdentities(candidates);

  // ---------------------------------------------------------------------
  // Group by mint authority — the issuer families
  // ---------------------------------------------------------------------

  const families = new Map<
    string,
    {authority: string; members: {mint: Pubkey; symbol: string; name: string; decimals: number; launches: number}[]}
  >();

  const rows = [
    ...ranked,
    // Range members the census never saw. Zero launches is the truth: nothing
    // on StonkFun quotes them yet, and inventing a count would rank them.
    ...extra.map((mint) => ({mint, asQuote: 0})),
  ];

  for (const row of rows) {
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
  const retired: string[] = [];
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

      // Retired paper and test mints. See `isRetired`.
      if (isRetired(member.symbol, member.name)) {
        retired.push(`${member.symbol} — ${member.name}`);
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
        transferFeeBps: account.transferFeeBps,
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

    if (retired.length > 0) {
      console.log(
        `\n  ${retired.length} mint(s) the issuer retired or marked test, left out:` +
          `\n    ${retired.slice(0, 6).join("\n    ")}` +
          (retired.length > 6 ? `\n    … ${retired.length - 6} more` : ""),
      );
    }

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
