import assert from "node:assert/strict";
import {test} from "node:test";

import {commentPosition} from "@/lib/commentPosition";

/*
 * The position printed beside a comment.
 *
 * It goes next to someone's name as a fact about them — "Holding, +59%" — so
 * every way it can be wrong is a small public lie about a real person. What is
 * pinned is that it only states a return it can fully account for.
 */

test("a holder's return counts what they still hold at today's price", () => {
  // Put in $100 for 1,000 units; they are now worth $0.25 each.
  const position = commentPosition([{side: "buy", amount: 1000, valueUsd: 100}], 0.25);

  assert.equal(position?.status, "holding");
  assert.equal(position?.boughtUsd, 100);
  assert.equal(position?.gainPct, 150);
});

test("a closed position shows what it made, with no price needed", () => {
  const position = commentPosition(
    [
      {side: "buy", amount: 1000, valueUsd: 100},
      {side: "sell", amount: 1000, valueUsd: 40},
    ],
    // The coin has no price now. A sold-out trade does not need one.
    null,
  );

  assert.equal(position?.status, "sold");
  assert.equal(position?.gainPct, -60);
});

test("a partial sell counts both what was taken and what is left", () => {
  const position = commentPosition(
    [
      {side: "buy", amount: 1000, valueUsd: 100},
      {side: "sell", amount: 500, valueUsd: 80},
    ],
    0.1,
  );

  assert.equal(position?.status, "holding");
  // $80 taken out + 500 × $0.10 still held = $130 on $100 in.
  assert.equal(position?.gainPct, 30);
});

test("the crumbs a router leaves after selling everything are not a position", () => {
  const position = commentPosition(
    [
      {side: "buy", amount: 1_000_000, valueUsd: 100},
      {side: "sell", amount: 999_999.5, valueUsd: 120},
    ],
    0.0001,
  );
  assert.equal(position?.status, "sold");
});

test("no return is claimed when any trade was unpriced", () => {
  // The dollar total would be partial, and a partial total shown as a
  // percentage looks exact and is not.
  const position = commentPosition(
    [
      {side: "buy", amount: 1000, valueUsd: 100},
      {side: "buy", amount: 500, valueUsd: null},
    ],
    1,
  );
  assert.equal(position?.status, "holding");
  assert.equal(position?.gainPct, null);
});

test("a holder with no current price gets a status but no return", () => {
  const position = commentPosition([{side: "buy", amount: 10, valueUsd: 5}], null);
  assert.equal(position?.status, "holding");
  assert.equal(position?.gainPct, null);
});

test("someone who never bought has no position to describe", () => {
  // Coins that arrived by transfer or airdrop and were sold.
  assert.equal(commentPosition([{side: "sell", amount: 10, valueUsd: 5}], 1), null);
  assert.equal(commentPosition([], 1), null);
});
