/**
 * The membership test.
 *
 * One rule, imported by the feed, search, the Stonkfolio and the indexer. The
 * predecessor app had two copies of its equivalent and they drifted, so its
 * feed and its search disagreed about which coins were real — a bug users
 * reported and nobody could reproduce, because each surface was internally
 * consistent.
 */
import assert from "node:assert/strict";
import {test} from "node:test";

import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {stockForTicker} from "@/lib/stocks/registry";
import {
  type UniverseInput,
  exclusionReason,
  isListed,
  isStockPaired,
  paysHoldersInStock,
  qualifiesForUniverse,
  quoteKindFor,
  statusFor,
} from "@/lib/universe";

const NVDAX = stockForTicker("NVDAx")!.mint;
const OPENAI = stockForTicker("OPENAI")!.mint;
const STONK = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

const base: UniverseInput = {
  launchpad: "stonkfun",
  quoteKind: "stock",
  rewardStock: null,
  graduated: true,
};

const input = (overrides: Partial<UniverseInput> = {}): UniverseInput => ({
  ...base,
  ...overrides,
});

test("quote mints are classified from the verified registry, not their names", () => {
  assert.equal(quoteKindFor(NVDAX), "stock");
  assert.equal(quoteKindFor(OPENAI), "stock");
  assert.equal(quoteKindFor(WSOL_MINT), "sol");
  assert.equal(quoteKindFor(USDC_MINT), "stable");

  // The launchpad's own token is a hugely popular quote asset and still not a
  // stock. Popularity is not provenance.
  assert.equal(quoteKindFor(STONK), "other");

  /*
   * A stock-shaped mint whose issuer is unverified is `other`, so the coin
   * fails arm 1 and goes missing — the safe direction.
   *
   * This used to use `tOpenAI`, which has since been verified as Tessera's and
   * is now a stock. That is the fixture working as intended rather than
   * breaking: "unverified" is a state assets leave, not a verdict, so an
   * example of it has a shelf life. `xSOL` replaces it — a leveraged SOL
   * derivative with 916 launches that any x-prefix rule would admit.
   */
  assert.equal(quoteKindFor("4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs"), "other");
});

test("arm 1: a recognised launch priced against a verified stock qualifies", () => {
  assert.equal(isStockPaired(input()), true);
  assert.equal(qualifiesForUniverse(input()), true);
  assert.equal(isListed(input()), true);
});

test("arm 2: a SOL-quoted launch that pays holders in stock qualifies", () => {
  const rewards = input({quoteKind: "sol", rewardStock: "NVDAx"});

  assert.equal(isStockPaired(rewards), false);
  assert.equal(paysHoldersInStock(rewards), true);
  assert.equal(qualifiesForUniverse(rewards), true);
  assert.equal(isListed(rewards), true);

  // Same for a stablecoin quote.
  assert.equal(
    qualifiesForUniverse(input({quoteKind: "stable", rewardStock: "SPYx"})),
    true,
  );
});

test("a SOL-quoted launch with no stock rewards does not qualify", () => {
  const plain = input({quoteKind: "sol", rewardStock: null});

  assert.equal(paysHoldersInStock(plain), false);
  assert.equal(qualifiesForUniverse(plain), false);
  assert.equal(isListed(plain), false);
});

test("rewards do not rescue an unrecognised quote asset", () => {
  // Arm 2 is deliberately narrow: SOL or a stablecoin. A coin quoted in another
  // launchpad coin that claims to pay stock rewards is not something this app
  // can price honestly, so it stays out.
  assert.equal(
    qualifiesForUniverse(input({quoteKind: "other", rewardStock: "NVDAx"})),
    false,
  );
});

test("an unrecognised launchpad never qualifies, whatever else is true", () => {
  for (const overrides of [
    {},
    {quoteKind: "stock" as const},
    {quoteKind: "sol" as const, rewardStock: "NVDAx"},
  ]) {
    const foreign = input({...overrides, launchpad: null});
    assert.equal(qualifiesForUniverse(foreign), false);
    assert.equal(isListed(foreign), false);
    assert.equal(exclusionReason(foreign), "not-a-recognised-launchpad");
  }
});

test("a coin on the curve is stored but not shown", () => {
  const onCurve = input({graduated: false});

  assert.equal(statusFor(onCurve), "pending");
  // It qualifies — it is a real stock-paired launch — it just is not listed yet.
  assert.equal(qualifiesForUniverse(onCurve), true);
  assert.equal(isListed(onCurve), false);
  assert.equal(exclusionReason(onCurve), "still-on-curve");
});

test("a graduated coin is listed", () => {
  assert.equal(statusFor(input({graduated: true})), "listed");
});

test("exclusion reasons distinguish the two ways arm 2 fails", () => {
  // Nothing to fix: the coin is not in scope.
  assert.equal(
    exclusionReason(input({quoteKind: "sol", rewardStock: null})),
    "no-holder-rewards-in-stock",
  );

  // Possibly something to fix: the quote asset may be a real stock whose
  // issuer has not been verified into the registry yet. Different reason,
  // because it points at different work.
  assert.equal(
    exclusionReason(input({quoteKind: "other"})),
    "quote-asset-not-a-verified-stock",
  );

  assert.equal(exclusionReason(input()), null);
});

test("a null quoteKind is treated as not-yet-classified and excluded", () => {
  // The indexer writes null before it has read the pool. That must not be
  // mistaken for a stock pairing.
  const unclassified = input({quoteKind: null});
  assert.equal(isStockPaired(unclassified), false);
  assert.equal(paysHoldersInStock(unclassified), false);
  assert.equal(qualifiesForUniverse(unclassified), false);
});

test("pump.fun launches go through the same two arms", () => {
  assert.equal(qualifiesForUniverse(input({launchpad: "pumpfun"})), true);
  assert.equal(
    qualifiesForUniverse(input({launchpad: "pumpfun", quoteKind: "sol", rewardStock: null})),
    false,
  );
});
