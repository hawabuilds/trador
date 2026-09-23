import assert from "node:assert/strict";
import {test} from "node:test";

import {filterNewFeedStonks} from "@/config/feed";
import {assertPubkey} from "@/lib/pubkey";
import {
  compareGraduatingStonks,
  isGraduatedListedStonk,
  isOnBondingCurve,
  isGraduatingStonk,
  sortStonksGraduating,
} from "@/lib/graduatingFeedSort";
import type {Stonk} from "@/lib/types";

const M1 = assertPubkey("11111111111111111111111111111112", "m1");
const M2 = assertPubkey("11111111111111111111111111111113", "m2");

function stonk(overrides: Partial<Stonk> & Pick<Stonk, "mint" | "id" | "status">): Stonk {
  return {
    kind: "stonk",
    name: "x",
    symbol: "X",
    pool: overrides.mint,
    launchpad: "stonkfun",
    creator: M1,
    quoteMint: M1,
    quoteTicker: "TSLA",
    quoteKind: "stock",
    paysHolders: false,
    rewards24hUsd: null,
    price: {usd: null, source: null, status: "no_pool", at: null},
    marketCapUsd: null,
    volume24hUsd: null,
    trendingScore: null,
    liquidityUsd: null,
    isTradeable: null,
    changePct: null,
    series: [],
    curveProgress: null,
    listedAt: null,
    imageUrl: null,
    decimals: 6,
    circulatingSupply: null,
    socials: null,
    ...overrides,
  };
}

test("graduating sort orders by curve progress descending", () => {
  const low = stonk({id: M1, mint: M1, status: "pending", curveProgress: 0.2});
  const high = stonk({id: M2, mint: M2, status: "pending", curveProgress: 0.85});
  const sorted = sortStonksGraduating([low, high]);
  assert.equal(sorted[0]?.mint, M2);
  assert.ok(compareGraduatingStonks(high, low) < 0);
});

test("graduating sort breaks equal progress by trending score then volume", () => {
  const quiet = stonk({
    id: M1,
    mint: M1,
    status: "pending",
    curveProgress: 0.7,
    trendingScore: 1,
    volume24hUsd: 100,
  });
  const hot = stonk({
    id: M2,
    mint: M2,
    status: "pending",
    curveProgress: 0.7,
    trendingScore: 5,
    volume24hUsd: 50,
  });
  const sorted = sortStonksGraduating([quiet, hot]);
  assert.equal(sorted[0]?.mint, M2);

  const volTie = stonk({
    id: M1,
    mint: M1,
    status: "pending",
    curveProgress: 0.7,
    trendingScore: null,
    volume24hUsd: 900,
  });
  const volLow = stonk({
    id: M2,
    mint: M2,
    status: "pending",
    curveProgress: 0.7,
    trendingScore: null,
    volume24hUsd: 100,
  });
  assert.equal(sortStonksGraduating([volLow, volTie])[0]?.mint, M1);
});

test("status guards separate graduating from graduated feeds", () => {
  const pending = stonk({id: M1, mint: M1, status: "pending", curveProgress: 0.5});
  const listed = stonk({id: M2, mint: M2, status: "listed", curveProgress: null});
  assert.ok(isGraduatingStonk(pending));
  assert.ok(isGraduatedListedStonk(listed));
  assert.ok(!isGraduatedListedStonk(pending));
});

test("listed status wins over stale curve progress", () => {
  const stale = stonk({id: M2, mint: M2, status: "listed", curveProgress: 0.66});
  assert.ok(!isOnBondingCurve(stale));
  assert.ok(isOnBondingCurve(stonk({id: M1, mint: M1, status: "pending", curveProgress: 0.5})));
});

test("new feed floor does not apply to pending rows mixed into a client list", () => {
  const recentPending = stonk({
    id: M1,
    mint: M1,
    status: "pending",
    marketCapUsd: 50_000,
    listedAt: new Date().toISOString(),
  });
  const filtered = filterNewFeedStonks([recentPending]);
  assert.equal(filtered.length, 1, "floor is mcap/recency only; status is filtered elsewhere");
});
