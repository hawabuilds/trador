import assert from "node:assert/strict";
import {test} from "node:test";

import {baseUnitsToScaled, scaledToBaseUnits, shareOf, toBaseUnits} from "@/lib/amounts";

/*
 * The ticket types, shows and quotes in tokens; only the transaction is in
 * base units. These are the three multipliers that make the two differ: a
 * fraction of a percent, half as much again, and a ten-for-one split.
 */
const SPYX = {multiplier: 1.005714560286254, decimals: 8};
const OPENAI = {multiplier: 1.4861347, decimals: 6};
const SPLIT = {multiplier: 10, decimals: 8}; // NFLXx after its ten-for-one

test("what is typed is tokens, what is signed is base units", () => {
  // A real SPYx balance: 109331615 base units, which the wallet shows as
  // 1.09956397 tokens.
  assert.equal(baseUnitsToScaled(109331615n, SPYX.decimals, SPYX.multiplier), "1.09956397");

  // Typing that figure back sizes to the balance, or a base unit under it.
  const signed = scaledToBaseUnits("1.09956397", SPYX.decimals, SPYX.multiplier);
  assert.ok(signed !== null && signed <= 109331615n);
  assert.ok(109331615n - signed! <= 1n);
});

test("a ten-for-one split is ten to one in both directions", () => {
  assert.equal(scaledToBaseUnits("10", SPLIT.decimals, SPLIT.multiplier), 100_000_000n);
  assert.equal(baseUnitsToScaled(100_000_000n, SPLIT.decimals, SPLIT.multiplier), "10");
  // Without it the ticket would size ten times the position.
  assert.equal(scaledToBaseUnits("10", SPLIT.decimals, 1), 1_000_000_000n);
});

test("typing half a position signs half the base units", () => {
  // 100 OPENAI held is 148.61347 tokens shown.
  const heldRaw = 100_000_000n;
  const shown = baseUnitsToScaled(heldRaw, OPENAI.decimals, OPENAI.multiplier);
  assert.equal(shown, "148.61347");

  const half = scaledToBaseUnits("74.306735", OPENAI.decimals, OPENAI.multiplier);
  assert.ok(half !== null);
  assert.ok(half! <= heldRaw / 2n);
  assert.ok(heldRaw / 2n - half! <= 1n);
});

test("selling the lot sends the balance, never a number typed back in", () => {
  for (const {multiplier, decimals} of [SPYX, OPENAI, SPLIT]) {
    const heldRaw = 109_331_615n;

    // What the 100% button prints, rounded down so it can always be sold.
    const printed = baseUnitsToScaled(heldRaw, decimals, multiplier);
    const roundTrip = scaledToBaseUnits(printed, decimals, multiplier);

    // The round trip can only lose, never gain — the ticket sends `heldRaw`
    // itself, which is why the dust the round trip leaves does not matter.
    assert.ok(roundTrip !== null && roundTrip! <= heldRaw, `${multiplier} over-sold`);
    assert.equal(shareOf(heldRaw, 100), heldRaw);
  }
});

test("the quick sizes stay inside the balance", () => {
  const heldRaw = 109_331_615n;
  for (const step of [25, 50, 75]) {
    const part = shareOf(heldRaw, step);
    const shown = baseUnitsToScaled(part, SPYX.decimals, SPYX.multiplier);
    const signed = scaledToBaseUnits(shown, SPYX.decimals, SPYX.multiplier);
    assert.ok(signed !== null && signed! <= part);
    assert.ok(part - signed! <= 1n);
  }
});

test("a buy shows the tokens that will arrive, not the base units", () => {
  // The router returns 3619401 base units of a mint scaled ten to one.
  assert.equal(baseUnitsToScaled(3_619_401n, SPLIT.decimals, SPLIT.multiplier), "0.3619401");
  // Shown unscaled it would read as a tenth of what lands in the wallet.
  assert.equal(baseUnitsToScaled(3_619_401n, SPLIT.decimals, 1), "0.03619401");
});

test("an unscaled mint converts exactly as it always did", () => {
  assert.equal(scaledToBaseUnits("1.5", 6, 1), toBaseUnits("1.5", 6));
  assert.equal(baseUnitsToScaled(1_500_000n, 6, 1), "1.5");
});

test("junk and nonsense multipliers never size a trade", () => {
  assert.equal(scaledToBaseUnits("abc", 6, OPENAI.multiplier), null);
  assert.equal(scaledToBaseUnits("", 6, 1), null);
  // A multiplier that cannot be read falls back to one rather than to zero,
  // which would send the whole balance as dust.
  assert.equal(scaledToBaseUnits("1", 6, Number.NaN), 1_000_000n);
  assert.equal(scaledToBaseUnits("1", 6, 0), 1_000_000n);
});

/*
 * The ticket's thresholds, pinned against the registry's.
 *
 * The screen admits a stock when a $250 buy moves the price less than 2%. If
 * the ticket were to warn at some other number, a stock could be listed as
 * tradable and sold without a word, or warned about on every trade — the two
 * have to be the same number.
 */
test("the ticket cautions from the same impact the registry screens at", async () => {
  const sheet = await import("node:fs").then((fs) =>
    fs.readFileSync("src/components/OrderSheet.tsx", "utf8"),
  );
  const screen = await import("node:fs").then((fs) =>
    fs.readFileSync("scripts/sync-stocks.ts", "utf8"),
  );

  const ticket = sheet.match(/const TRADABLE_IMPACT_PCT = (\d+(?:\.\d+)?)/)?.[1];
  const sync = screen.match(/const MAX_IMPACT_PCT = (\d+(?:\.\d+)?)/)?.[1];

  assert.equal(ticket, sync, "the ticket and the sync disagree about 'too much impact'");
  assert.equal(ticket, "2");
});

test("a mint's own transfer fee reaches the ticket", async () => {
  const {stockForTicker} = await import("@/lib/stocks/registry");

  // PreStocks takes 1% on OPENAI and Tessera 0.2%, both off the mint account.
  assert.equal(stockForTicker("OPENAI")?.transferFeeBps, 100);
  assert.equal(stockForTicker("tOpenAI")?.transferFeeBps, 20);
  // Backed and Backpack charge none, and the row is not rendered for them.
  assert.equal(stockForTicker("NVDAx")?.transferFeeBps, null);
  assert.equal(stockForTicker("NFLX")?.transferFeeBps, null);
});
