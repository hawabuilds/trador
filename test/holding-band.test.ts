import assert from "node:assert/strict";
import {test} from "node:test";

import {bandFor, boughtEarly} from "@/lib/holdingBand";

test("bands round down, never up", () => {
  assert.equal(bandFor(249), "50");
  assert.equal(bandFor(250), "250");
  assert.equal(bandFor(999.99), "250");
  assert.equal(bandFor(1_000), "1k");
  assert.equal(bandFor(10), "10");
});

test("under the floor to comment is no band at all", () => {
  assert.equal(bandFor(9.99), null);
  assert.equal(bandFor(0), null);
  assert.equal(bandFor(null), null);
  assert.equal(bandFor(Number.NaN), null);
});

test("early is a buy under three times the earliest price we hold", () => {
  assert.equal(boughtEarly({firstBuyPriceUsd: 1, earliestPriceUsd: 1}), true);
  assert.equal(boughtEarly({firstBuyPriceUsd: 2.99, earliestPriceUsd: 1}), true);
  assert.equal(boughtEarly({firstBuyPriceUsd: 3, earliestPriceUsd: 1}), false);
  assert.equal(boughtEarly({firstBuyPriceUsd: 12, earliestPriceUsd: 1}), false);
});

test("early is withheld when either price is missing or nonsense", () => {
  assert.equal(boughtEarly({firstBuyPriceUsd: null, earliestPriceUsd: 1}), false);
  assert.equal(boughtEarly({firstBuyPriceUsd: 1, earliestPriceUsd: null}), false);
  assert.equal(boughtEarly({firstBuyPriceUsd: 0, earliestPriceUsd: 1}), false);
  assert.equal(boughtEarly({firstBuyPriceUsd: 1, earliestPriceUsd: 0}), false);
});
