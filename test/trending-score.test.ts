import {strict as assert} from "node:assert";
import {test} from "node:test";

import {computeTrendingScore} from "@/lib/trendingScore";

test("trending score weights recent volume highest", () => {
  const hot1h = computeTrendingScore({
    vol1hUsd: 1_000_000,
    vol24hUsd: 100_000,
    txs24h: 100,
    uniqueMakers24h: 50,
  });
  const flat1h = computeTrendingScore({
    vol1hUsd: 10_000,
    vol24hUsd: 1_000_000,
    txs24h: 100,
    uniqueMakers24h: 50,
  });
  assert.ok(hot1h !== null && flat1h !== null);
  assert.ok(hot1h > flat1h);
});

test("trending score is null with no activity metrics", () => {
  assert.equal(
    computeTrendingScore({
      vol1hUsd: null,
      vol24hUsd: null,
      txs24h: null,
      uniqueMakers24h: null,
    }),
    null,
  );
});

test("page views add a small bump when activity exists", () => {
  const base = computeTrendingScore({
    vol1hUsd: 50_000,
    vol24hUsd: 200_000,
    txs24h: 500,
    uniqueMakers24h: 120,
    pageViews: 0,
  });
  const boosted = computeTrendingScore({
    vol1hUsd: 50_000,
    vol24hUsd: 200_000,
    txs24h: 500,
    uniqueMakers24h: 120,
    pageViews: 10_000,
  });
  assert.ok(base !== null && boosted !== null);
  assert.ok(boosted > base);
});
