import assert from "node:assert/strict";
import {test} from "node:test";

import {STEP_MS, fillCandles} from "@/lib/fillCandles";
import {TIMEFRAMES} from "@/lib/types";

/*
 * Filling the buckets a provider left out.
 *
 * GeckoTerminal emits a candle only for a bucket that traded, so a quiet coin
 * has holes rather than flat candles. What is pinned here is that filling never
 * invents movement: a filled bucket carries the previous close as its open,
 * high, low and close, so the worst it can do is draw a flat line.
 */

const STEP = STEP_MS["15m"];
const at = (buckets: number, price: number) => ({
  t: buckets * STEP,
  price,
  open: price,
  high: price,
  low: price,
});

test("a hole is filled at the previous close, one candle per bucket", () => {
  const filled = fillCandles([at(0, 10), at(4, 12)], STEP);

  assert.deepEqual(
    filled.map((p) => p.t / STEP),
    [0, 1, 2, 3, 4],
  );
  // Three filled buckets, all flat at the last real close of 10.
  for (const point of filled.slice(1, 4)) {
    assert.deepEqual(
      [point.price, point.open, point.high, point.low],
      [10, 10, 10, 10],
      "a filled candle must not imply a high or low that never traded",
    );
  }
  assert.equal(filled[4].price, 12);
});

test("a series with no holes is unchanged", () => {
  const points = [at(0, 10), at(1, 11), at(2, 12)];
  assert.deepEqual(fillCandles(points, STEP), points);
});

test("clock skew inside one bucket is not a gap", () => {
  // Providers do not always land exactly on the boundary.
  const points = [{t: 0, price: 10}, {t: STEP + 3_000, price: 11}];
  assert.equal(fillCandles(points, STEP).length, 2);
});

test("an enormous gap is left alone rather than fabricated", () => {
  // A coin dormant for weeks would otherwise become thousands of points to
  // draw a flat line; at that width the jump is the more honest picture.
  const filled = fillCandles([at(0, 10), at(5_000, 12)], STEP);
  assert.equal(filled.length, 2);
});

test("degenerate inputs are returned as they came", () => {
  assert.deepEqual(fillCandles([], STEP), []);
  assert.deepEqual(fillCandles([at(0, 10)], STEP), [at(0, 10)]);
  assert.deepEqual(fillCandles([at(0, 10), at(2, 11)], 0), [at(0, 10), at(2, 11)]);
});

test("every timeframe the chart offers has a bucket width", () => {
  // A missing entry would silently disable filling for that timeframe.
  for (const timeframe of TIMEFRAMES) {
    assert.ok(STEP_MS[timeframe] > 0, `no step for ${timeframe}`);
  }
});
