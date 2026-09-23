import assert from "node:assert/strict";
import {test} from "node:test";

import {filterNewFeedStonks, NEW_FEED_MIN_MCAP_USD} from "@/config/feed";
import {assertPubkey} from "@/lib/pubkey";
import {snapshotStonkQuoteCounts} from "@/lib/server/snapshot";
import type {Stonk} from "@/lib/types";

const M1 = assertPubkey("11111111111111111111111111111112", "m1");

function stonk(
  overrides: Partial<Stonk> & Pick<Stonk, "mint" | "quoteTicker">,
): Stonk {
  return {
    kind: "stonk",
    id: overrides.mint,
    name: "x",
    symbol: "X",
    pool: overrides.mint,
    launchpad: "stonkfun",
    creator: M1,
    status: "listed",
    quoteMint: M1,
    quoteKind: "stock",
    paysHolders: false,
    rewards24hUsd: null,
    price: {usd: 1, source: "pool", status: "priced", at: null},
    marketCapUsd: overrides.marketCapUsd ?? 50_000,
    volume24hUsd: null,
    trendingScore: null,
    liquidityUsd: null,
    isTradeable: true,
    changePct: null,
    series: [],
    curveProgress: null,
    listedAt: overrides.listedAt ?? null,
    imageUrl: null,
    decimals: 6,
    circulatingSupply: null,
    socials: null,
    ...overrides,
  };
}

test("snapshot quote counts apply sort-specific floors", () => {
  const newCounts = snapshotStonkQuoteCounts("new");
  const trending = snapshotStonkQuoteCounts("trending");
  const marketCap = snapshotStonkQuoteCounts("marketCap");
  assert.ok(trending.total <= marketCap.total);
  assert.ok(newCounts.total <= marketCap.total);
});

test("filterNewFeedStonks drops sub-floor coins unless recent", () => {
  const old = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: 500,
    listedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
  });
  const kept = filterNewFeedStonks([old]);
  assert.equal(kept.length, 0);

  const recent = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: 500,
    listedAt: new Date().toISOString(),
  });
  assert.equal(filterNewFeedStonks([recent]).length, 1);

  const big = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: NEW_FEED_MIN_MCAP_USD,
  });
  assert.equal(filterNewFeedStonks([big]).length, 1);

  const staleUnpriced = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: null,
    listedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
  });
  assert.equal(filterNewFeedStonks([staleUnpriced]).length, 0);

  const freshUnpriced = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: null,
    listedAt: new Date().toISOString(),
  });
  assert.equal(filterNewFeedStonks([freshUnpriced]).length, 0);

  const zeroMcap = stonk({
    mint: M1,
    quoteTicker: "TSLA",
    marketCapUsd: 0,
    listedAt: new Date().toISOString(),
  });
  assert.equal(filterNewFeedStonks([zeroMcap]).length, 0);
});
