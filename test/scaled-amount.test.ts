import assert from "node:assert/strict";
import {test} from "node:test";

import {effectiveMultiplier, liveUiAmount, scaledUi} from "@/lib/scaledAmount";
import {scalePosition, holdingProfit, type Position} from "@/lib/walletTrades";
import {bandFor} from "@/lib/holdingBand";
import {commentPosition} from "@/lib/commentPosition";

/*
 * The multipliers these three mints were actually carrying when this was
 * written, read off chain. Real numbers rather than round ones, because the
 * bug they describe is a fraction of a percent on one and half a position on
 * another, and a test with a multiplier of 2 would not notice the difference.
 */
const SPYX = 1.005714560286254;
const MCDX = 1.0211807004882871;
const OPENAI = 1.4861347;

test("a scaled balance is the raw amount times the multiplier", () => {
  // A real SPYx token account: 109331615 base units at 8 decimals, which the
  // RPC reports as 1.09956397 tokens.
  assert.equal(scaledUi(109331615, 8, SPYX).toFixed(8), "1.09956397");
  // Without the multiplier it reads 0.57% short.
  assert.equal(scaledUi(109331615, 8, 1).toFixed(8), "1.09331615");
});

test("the pending multiplier takes over once its moment has passed", () => {
  // NFLXx: still carrying 1, with the split's 10 already due.
  const split = {multiplier: 1, newMultiplier: 10, newMultiplierEffectiveTimestamp: 1_763_337_300};
  assert.equal(effectiveMultiplier(split, 1_763_337_299), 1);
  assert.equal(effectiveMultiplier(split, 1_763_337_300), 10);

  // SPYx's next accrual is still in the future, so today's figure stands.
  const accruing = {
    multiplier: SPYX,
    newMultiplier: 1.0057145602862541,
    newMultiplierEffectiveTimestamp: 1_781_755_200,
  };
  assert.equal(effectiveMultiplier(accruing, 1_700_000_000), SPYX);
});

test("a mint with no scaled extension is left alone", () => {
  assert.equal(effectiveMultiplier(null), 1);
  assert.equal(effectiveMultiplier(undefined), 1);
  assert.equal(scaledUi(500_000_000, 6, 1), 500);
});

test("a nonsense multiplier never eats somebody's balance", () => {
  assert.equal(effectiveMultiplier({multiplier: 0}), 1);
  assert.equal(effectiveMultiplier({multiplier: Number.NaN}), 1);
  assert.equal(scaledUi(1_000_000, 6, Number.NaN), 1);
});

test("the RPC's own figure wins over anything we would compute", () => {
  // It already carries the multiplier, so it needs no help — and it is right
  // even when we never looked the multiplier up.
  assert.equal(liveUiAmount({uiAmount: 1.09956397, amount: "109331615", decimals: 8}), 1.09956397);
  // Only when it is missing do we fall back to doing it ourselves.
  assert.equal(
    liveUiAmount({amount: "109331615", decimals: 8}, SPYX).toFixed(8),
    "1.09956397",
  );
  assert.equal(liveUiAmount({amount: "109331615", decimals: 8}).toFixed(8), "1.09331615");
});

test("a holding band is read from the scaled amount, not the raw one", () => {
  // 700 OPENAI at $1 is a $1K+ holder once the multiplier is applied, and a
  // $250+ one without it. The band under a comment is the claim being made.
  const price = 1;
  assert.equal(bandFor(scaledUi(700_000_000, 6, OPENAI) * price), "1k");
  assert.equal(bandFor(scaledUi(700_000_000, 6, 1) * price), "250");
});

test("P&L compares a scaled balance against a scaled position", () => {
  // Bought 100 OPENAI for $100 and never sold. The wallet now reads 148.61.
  const position: Position = {mint: "OPENAI", qty: 100, costUsd: 100, complete: true};
  const held = 100 * OPENAI;
  const valueUsd = held * 2; // the price doubled

  const unscaled = holdingProfit(held, valueUsd, position);
  const scaled = holdingProfit(held, valueUsd, scalePosition(position, OPENAI));

  // Against the unscaled position only the first 100 units are covered, so
  // the profit on the other 48.61 is simply missing, and the leftover makes
  // the row read as partial.
  assert.equal(unscaled?.partial, true);
  assert.equal(unscaled?.usd.toFixed(2), "100.00");

  // Scaled, the whole position is covered and the profit is the real $197.23 —
  // the unscaled figure was short by $97.23 on a $100 position.
  assert.equal(scaled?.partial, false);
  assert.equal(scaled?.usd.toFixed(2), (valueUsd - 100).toFixed(2));
});

test("a position with no multiplier is returned untouched", () => {
  const position: Position = {mint: "SOL", qty: 12, costUsd: 300, complete: true};
  assert.equal(scalePosition(position, 1), position);
  assert.equal(scalePosition(position, Number.NaN), position);
});

test("a comment's held value uses the same unit as the price", () => {
  const trades = [{side: "buy" as const, amount: 100 * MCDX, valueUsd: 100}];
  const position = commentPosition(trades, 3);
  assert.ok(position);
  // 102.118 tokens at $3, not 100 at $3.
  assert.equal(position.heldUsd?.toFixed(2), (100 * MCDX * 3).toFixed(2));
});
