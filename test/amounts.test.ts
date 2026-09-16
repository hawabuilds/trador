import assert from "node:assert/strict";
import {test} from "node:test";

import {
  SOL_FEE_RESERVE_LAMPORTS,
  fromBaseUnits,
  shareOf,
  spendableLamports,
  toBaseUnits,
} from "@/lib/amounts";

// A real ALLINU balance: 332.652094 at 6 decimals.
const ALLINU = 332_652_094n;

test("sell all round-trips the exact balance through the amount field", () => {
  const text = fromBaseUnits(shareOf(ALLINU, 100), 6);
  assert.equal(text, "332.652094");
  assert.equal(toBaseUnits(text, 6), ALLINU);
});

test("100% is the balance itself even where a float round-trip drifts", () => {
  // 9 decimals and 18 significant digits: past what a double holds exactly.
  const raw = 123_456_789_123_456_789n;
  assert.notEqual(BigInt(Math.round(Number(fromBaseUnits(raw, 9)) * 1e9)), raw);
  assert.equal(toBaseUnits(fromBaseUnits(shareOf(raw, 100), 9), 9), raw);
});

test("partial shares round down, never above the position", () => {
  assert.equal(shareOf(ALLINU, 25), 83_163_023n);
  assert.equal(shareOf(ALLINU, 50), 166_326_047n);
  assert.equal(shareOf(ALLINU, 75), 249_489_070n);
  assert.equal(shareOf(3n, 50), 1n);
  assert.equal(shareOf(ALLINU, 0), 0n);
});

test("typed amounts parse exactly and truncate past the token's precision", () => {
  assert.equal(toBaseUnits("25", 6), 25_000_000n);
  assert.equal(toBaseUnits("0.1", 9), 100_000_000n);
  assert.equal(toBaseUnits(".5", 6), 500_000n);
  assert.equal(toBaseUnits("5.", 6), 5_000_000n);
  // Truncated, never rounded up past what was typed.
  assert.equal(toBaseUnits("1.9999999", 6), 1_999_999n);
});

test("anything that is not a plain decimal is refused", () => {
  for (const bad of ["", ".", "abc", "1e5", "-1", "1.2.3", "1,000"]) {
    assert.equal(toBaseUnits(bad, 6), null, bad);
  }
});

test("base units format without trailing zeros", () => {
  assert.equal(fromBaseUnits(0n, 6), "0");
  assert.equal(fromBaseUnits(1n, 6), "0.000001");
  assert.equal(fromBaseUnits(25_000_000n, 6), "25");
  assert.equal(fromBaseUnits(1_500_000_000n, 9), "1.5");
});

test("a SOL-funded buy leaves room for its own fees", () => {
  assert.equal(spendableLamports(1_000_000_000n), 1_000_000_000n - SOL_FEE_RESERVE_LAMPORTS);
  assert.equal(spendableLamports(SOL_FEE_RESERVE_LAMPORTS), 0n);
  assert.equal(spendableLamports(5_000n), 0n);
});
