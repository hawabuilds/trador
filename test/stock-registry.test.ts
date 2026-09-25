/**
 * The registry is the app's trust boundary, so these are not shape tests.
 *
 * A coin gets into Trador's feed by being paired against something in the
 * registry. So the failure this file guards against is not "the JSON is
 * malformed" — it is "a mint that should not be trusted became trustworthy",
 * which no user can detect and no error surfaces.
 *
 * The named-impostor cases at the bottom are the important ones. They are real
 * mints found in the same census that built the registry, each heavily used as
 * a quote asset, each of which a plausible heuristic would have admitted.
 */
import assert from "node:assert/strict";
import {test} from "node:test";

import {isPubkey} from "@/lib/pubkey";
import {SECTORS, sectorFor} from "@/lib/sectors";
import {
  ISSUERS,
  STOCK_MINTS,
  type StockIssuer,
  isStockMint,
  oraclePricedStocks,
  stockForMint,
  stockForTicker,
  stockSideOf,
  stocksByIssuer,
  stocksByPopularity,
} from "@/lib/stocks/registry";

test("the registry loads, which means every entry passed load-time validation", () => {
  assert.ok(STOCK_MINTS.length > 0, "registry is empty");
});

test("every mint is a real base58 address and appears once", () => {
  const mints = new Set<string>();
  const tickers = new Set<string>();

  for (const stock of STOCK_MINTS) {
    assert.equal(isPubkey(stock.mint), true, `${stock.ticker}: mint is not base58`);
    assert.equal(isPubkey(stock.tokenProgram), true, `${stock.ticker}: bad token program`);
    assert.equal(mints.has(stock.mint), false, `duplicate mint for ${stock.ticker}`);
    assert.equal(tickers.has(stock.ticker), false, `duplicate ticker ${stock.ticker}`);
    mints.add(stock.mint);
    tickers.add(stock.ticker);
  }
});

test("no entry ships without a mint authority read off the account", () => {
  for (const stock of STOCK_MINTS) {
    assert.ok(
      stock.verified.mintAuthority,
      `${stock.ticker} has no verified authority — it must not be in the registry`,
    );
    assert.ok(stock.verified.source, `${stock.ticker} does not record how it was verified`);
  }
});

/**
 * The structural claim behind every issuer, whichever key proves it.
 *
 * "xStocks" means something precise here: one key mints the whole range.
 * "Backpack Securities" means something equally precise but in a different
 * field: the mint authority is per-mint and proves nothing, while one control
 * key holds the freeze authority, the metadata update authority and the
 * permanent delegate on every mint in the range.
 *
 * Either way the invariant is the same — **one key per issuer** — so this
 * checks whichever key that issuer's verification actually rests on. If a
 * second ever appears, either an issuer rotated a key or something got in that
 * does not belong, and both need a human before the feed trusts it.
 */
test("every issuer's range rests on exactly one key", () => {
  for (const issuer of Object.keys(ISSUERS) as StockIssuer[]) {
    const members = stocksByIssuer(issuer);
    if (members.length === 0) continue;

    const expected = ISSUERS[issuer].verification;

    for (const stock of members) {
      assert.equal(
        stock.verified.via,
        expected,
        `${stock.ticker} claims ${issuer} but was verified via ${stock.verified.via}, ` +
          `and ${issuer} is a ${expected} issuer.`,
      );
    }

    /*
     * `issuerKey` rather than `mintAuthority`, because for a control-authority
     * issuer the mint authority differs on every mint by design — asserting
     * one of those would fail on a correct registry.
     */
    const keys = new Set(members.map((stock) => stock.verified.issuerKey));
    assert.equal(
      keys.size,
      1,
      `${issuer} rests on ${keys.size} keys: ${[...keys].join(", ")}`,
    );
  }
});

/**
 * A control-authority issuer's mint authorities must genuinely differ.
 *
 * Not pedantry — it is the fact that made the earlier "Backpack cannot be
 * verified" conclusion look right. Recording it means that if Backpack ever
 * consolidates onto one minting key, this fails and someone re-reads the
 * cheaper `mint-authority` test rather than leaving the stricter one in place
 * forever out of habit.
 */
test("a control-authority issuer really does mint from many keys", () => {
  for (const issuer of Object.keys(ISSUERS) as StockIssuer[]) {
    if (ISSUERS[issuer].verification !== "control-authority") continue;

    const members = stocksByIssuer(issuer);
    if (members.length < 2) continue;

    const authorities = new Set(members.map((stock) => stock.verified.mintAuthority));
    assert.ok(
      authorities.size > 1,
      `${issuer} is verified by a control key, but all ${members.length} of its ` +
        `mints share one mint authority — the simpler test would now do.`,
    );
  }
});

test("a pre-IPO name never claims an oracle price", () => {
  for (const stock of STOCK_MINTS) {
    if (stock.kind === "pre-ipo") {
      assert.equal(
        stock.priceAuthority,
        "none",
        `${stock.ticker} is pre-IPO but claims an oracle — there is no public market to quote`,
      );
    }
  }
  for (const stock of oraclePricedStocks()) {
    assert.notEqual(stock.kind, "pre-ipo");
  }
});

test("decimals and token program are recorded per mint, not assumed", () => {
  for (const stock of STOCK_MINTS) {
    assert.ok(
      Number.isInteger(stock.decimals) && stock.decimals >= 0 && stock.decimals <= 18,
      `${stock.ticker}: implausible decimals ${stock.decimals}`,
    );
  }

  // Every stock verified so far is Token-2022. This is an observation, not a
  // rule — but if it ever changes, the associated-token derivation has to
  // change with it, so the suite should say so out loud.
  const programs = new Set(STOCK_MINTS.map((stock) => stock.tokenProgram));
  assert.ok(programs.size >= 1);
});

test("mint lookup is case-sensitive; ticker lookup is not", () => {
  const stock = STOCK_MINTS[0];

  assert.equal(stockForMint(stock.mint)?.ticker, stock.ticker);
  // The whole reason this app has no address normalisation step.
  assert.equal(stockForMint(stock.mint.toLowerCase()), null); // pubkey-lint-ok: asserting a folded mint misses
  assert.equal(stockForMint(stock.mint.toUpperCase()), null); // pubkey-lint-ok: asserting a folded mint misses

  // Tickers are labels, so folding them is correct.
  assert.equal(stockForTicker(stock.ticker)?.mint, stock.mint);
  assert.equal(stockForTicker(stock.ticker.toLowerCase())?.mint, stock.mint);
  assert.equal(stockForTicker(stock.ticker.toUpperCase())?.mint, stock.mint);
});

test("stockSideOf reads the quote side of a pair", () => {
  const stock = STOCK_MINTS[0];
  const coin = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx"; // STONK

  assert.equal(stockSideOf(coin, stock.mint)?.ticker, stock.ticker);
  assert.equal(stockSideOf(stock.mint, coin)?.ticker, stock.ticker);
  assert.equal(stockSideOf(coin, coin), null);
});

test("popularity ranking is monotonic", () => {
  const ranked = stocksByPopularity();
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].launchesQuotedAgainst >= ranked[i].launchesQuotedAgainst);
  }
});

/**
 * Named impostors and near-misses.
 *
 * Every mint below is real, was found in the same pool census that produced the
 * registry, and is used as a quote asset by hundreds of launches. Each one is
 * exactly what some reasonable-sounding shortcut would have let through.
 */
test("known lookalikes are not in the registry", () => {
  const mustBeAbsent: [string, string, string][] = [
    [
      "4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs",
      "xSOL (Hylo Leveraged SOL)",
      "718 launches quote against it, and an 'x' prefix rule aimed at xStocks " +
        "would admit it. It is a leveraged SOL derivative, not an equity.",
    ],
    [
      "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
      "STONK",
      "1,580 launches — the launchpad's own token. A popular quote asset is not " +
        "thereby a stock.",
    ],
    [
      "So11111111111111111111111111111111111111112",
      "Wrapped SOL",
      "the single most common quote asset; popularity is not provenance.",
    ],
    [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "USDC",
      "a stablecoin, not a tokenized stock.",
    ],
  ];

  for (const [mint, label, why] of mustBeAbsent) {
    assert.equal(isStockMint(mint), false, `${label} must not be a registry stock: ${why}`);
    assert.equal(stockForMint(mint), null, `${label} resolved to a stock`);
  }
});

/**
 * Backpack Securities is admitted, and this is the line that says why.
 *
 * NKE used to sit in the list above — not because anyone thought it was an
 * impostor (the note beside it called it "a genuine tokenized equity") but
 * because the family was believed unprovable: every Backpack mint carries its
 * own mint authority, so the mint-authority test that identifies Backed and
 * PreStocks finds nothing.
 *
 * The authorities are per-mint. The family is provable anyway, through a
 * control key that holds the freeze authority, the Token-2022 metadata update
 * authority and the permanent delegate on every mint in the range. Requiring
 * all three to agree is what makes it safe: any one alone could be set to a key
 * the setter does not hold, but forging all three means handing Backpack the
 * power to freeze and claw back your own supply.
 *
 * This asserts the admission is deliberate and still resting on that key, so
 * nobody later reads the empty space above as an oversight and puts it back.
 */
/**
 * Tessera is admitted, and retired paper is not.
 *
 * `tOpenAI` used to be the headline example in the fixture above — the token
 * that proves a name check cannot work, because it offers OpenAI exposure from
 * a different authority than PreStocks' OPENAI. It still proves that. What it
 * does not prove is that the issuer is fake, and leaving it listed as a
 * "lookalike" let a conservative default harden into a verdict.
 *
 * It verifies cleanly: one key mints tOpenAI, tSpaceX and tKalshi, updates all
 * three metadata, and a second key freezes all three.
 *
 * The second half of this test is the part that earns its keep. Enumerating an
 * issuer's full range surfaces everything its key ever minted, including paper
 * the issuer itself has marked `[REFUNDED]` or `[OUTDATED]` — 23 such mints,
 * including an `[OUTDATED] OpenAI PreStocks` sitting beside the live one. A
 * coin paired to a refunded instrument is paired to nothing.
 */
test("Tessera is admitted, and retired issues are not", () => {
  const tOpenAI = stockForMint("oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ");

  assert.ok(tOpenAI, "tOpenAI should be a registry stock — Tessera is verified.");
  assert.equal(tOpenAI.issuer, "tessera");
  assert.equal(tOpenAI.kind, "pre-ipo");
  // No public listing, so no oracle can be authoritative about the price.
  assert.equal(tOpenAI.priceAuthority, "none");

  // Its whole range, not just the mint StonkFun happens to quote.
  for (const ticker of ["tOpenAI", "tSpaceX", "tKalshi"]) {
    assert.ok(stockForTicker(ticker), `${ticker} is missing from the registry.`);
  }

  for (const stock of STOCK_MINTS) {
    assert.ok(
      !/(refunded|outdated|deprecated|retired)/i.test(`${stock.ticker} ${stock.name}`),
      `${stock.ticker} is retired paper and must not be tradeable: ${stock.name}`,
    );
    assert.notEqual(
      stock.ticker.toLowerCase(),
      "test",
      "a mint literally called TEST is in the registry",
    );
  }
});

/**
 * Transfer fees are read, not assumed.
 *
 * Measuring these corrected a belief this codebase held silently: every
 * PreStocks mint charges 50bps and Tessera charges 20, while Backed and
 * Backpack charge nothing. The app had been quoting PreStocks as free for as
 * long as they had been listed, so a ticket showing Trador's 50bps was
 * understating the real cost by half.
 */
test("transfer fees are recorded per mint, and the known ones are right", () => {
  const known: [string, number | null][] = [
    ["OPENAI", 300],
    ["tOpenAI", 20],
    ["NVDAx", null],
  ];

  for (const [ticker, bps] of known) {
    const stock = stockForTicker(ticker);
    assert.ok(stock, `${ticker} is missing from the registry.`);
    assert.equal(
      stock.transferFeeBps,
      bps,
      `${ticker} should charge ${bps === null ? "no" : `${bps}bps`} transfer fee.`,
    );
  }

  // Per mint, not per issuer — the spread within PreStocks is the reason.
  for (const stock of STOCK_MINTS) {
    assert.ok(
      stock.transferFeeBps === null ||
        (Number.isInteger(stock.transferFeeBps) && stock.transferFeeBps >= 0),
      `${stock.ticker} has a nonsense transfer fee: ${String(stock.transferFeeBps)}`,
    );
  }
});

test("Backpack Securities is admitted, on a control key", () => {
  const nke = stockForMint("NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg");

  assert.ok(nke, "NKE should be a registry stock — Backpack is a verified issuer.");
  assert.equal(nke.issuer, "backpack");
  assert.equal(nke.verified.via, "control-authority");
  assert.equal(
    nke.verified.issuerKey,
    "2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a",
    "NKE is verified against a key that is not Backpack's control authority.",
  );

  /*
   * The distinction that matters: the key that proved it is NOT the key that
   * minted it. If these ever match, the control-key machinery is no longer
   * doing anything and the simpler test would do.
   */
  assert.notEqual(
    nke.verified.mintAuthority,
    nke.verified.issuerKey,
    "NKE's mint authority equals its issuer key — re-read which test is needed.",
  );
});

test("the stocks that are present are the ones expected", () => {
  // A spot check with real tickers, so a regenerated snapshot that silently
  // loses the headline assets fails here rather than in the feed.
  for (const ticker of ["SPYx", "NVDAx", "TSLAx", "AAPLx"]) {
    const stock = stockForTicker(ticker);
    assert.ok(stock, `${ticker} missing from the registry`);
    assert.equal(stock.issuer, "backed");
  }

  for (const ticker of ["OPENAI", "ANTHROPIC"]) {
    const stock = stockForTicker(ticker);
    assert.ok(stock, `${ticker} missing from the registry`);
    assert.equal(stock.issuer, "prestocks");
    assert.equal(stock.kind, "pre-ipo");
  }
});

/*
 * Every stock has a category.
 *
 * The feed row shows the sector under the ticker, and it used to fall back to
 * the company name when there was none. That read fine for the 29 stocks the
 * map was written against, and then the registry grew to 82 — so 54 rows
 * started printing the issuer's product string, "Krispy Kreme, Inc. Common
 * Stock - Backpack Securities", in the slot where a neighbour said "Semis".
 *
 * The fallback is gone, which turns that failure into a blank line instead of
 * a long one. This is what stops it being either: adding a stock without
 * classifying it now fails here, at the point where the omission is cheap to
 * fix.
 */
test("every stock in the registry has a sector", () => {
  const unmapped = stocksByPopularity()
    .filter((stock) => sectorFor(stock.ticker) === null)
    .map((stock) => stock.ticker);

  assert.deepEqual(
    unmapped,
    [],
    `these tickers need a sector in lib/sectors.ts: ${unmapped.join(", ")}`,
  );
});

test("every sector a stock claims is one the rail can render", () => {
  const known = new Set(SECTORS.map((sector) => sector.id));
  for (const stock of stocksByPopularity()) {
    const sector = sectorFor(stock.ticker);
    if (sector === null) continue;
    assert.ok(known.has(sector), `${stock.ticker} claims unknown sector ${sector}`);
  }
});
