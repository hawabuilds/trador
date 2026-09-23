import assert from "node:assert/strict";
import {test} from "node:test";

import {
  filterTrendingFeedStonks,
  TRENDING_MIN_MCAP_USD,
} from "@/config/feed";
import {assertPubkey} from "@/lib/pubkey";
import type {Stonk} from "@/lib/types";
import {
  compareTrendingStonks,
  encodeTrendingCursor,
  parseTrendingCursor,
  sortStonksTrending,
  trendingCursorFilter,
} from "@/lib/trendingFeedSort";

const M1 = assertPubkey("11111111111111111111111111111112", "m1");
const M2 = assertPubkey("11111111111111111111111111111113", "m2");
const M3 = assertPubkey("11111111111111111111111111111114", "m3");

function stonk(
  overrides: Partial<Stonk> & Pick<Stonk, "mint" | "id">,
): Stonk {
  return {
    kind: "stonk",
    name: "x",
    symbol: "X",
    pool: overrides.mint,
    launchpad: "stonkfun",
    creator: M1,
    status: "listed",
    quoteMint: M1,
    quoteTicker: "TSLA",
    quoteKind: "stock",
    paysHolders: false,
    rewards24hUsd: null,
    price: {usd: 1, source: "pool", status: "priced", at: null},
    marketCapUsd: 1_000_000,
    volume24hUsd: null,
    trendingScore: null,
    liquidityUsd: null,
    isTradeable: true,
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

test("trending sort prefers score, then volume — not market cap", () => {
  const highMcapLowScore = stonk({
    id: M1,
    mint: M1,
    marketCapUsd: 10_000_000,
    trendingScore: 1,
    volume24hUsd: 100,
  });
  const lowMcapHighScore = stonk({
    id: M2,
    mint: M2,
    marketCapUsd: 1_000,
    trendingScore: 5,
    volume24hUsd: 50,
  });

  const sorted = sortStonksTrending([highMcapLowScore, lowMcapHighScore]);
  assert.equal(sorted[0]?.mint, M2);
});

test("trending sort falls back to volume when scores tie or are null", () => {
  const a = stonk({id: M1, mint: M1, trendingScore: null, volume24hUsd: 200, marketCapUsd: 9});
  const b = stonk({id: M2, mint: M2, trendingScore: null, volume24hUsd: 800, marketCapUsd: 1});
  assert.ok(compareTrendingStonks(a, b) > 0, "higher volume ranks first when scores are null");
});

test("trending cursor round-trip and filter uses vol tiebreak", () => {
  const encoded = encodeTrendingCursor({score: 4.2, vol: 9000, mint: M3});
  assert.deepEqual(parseTrendingCursor(encoded), {score: 4.2, vol: 9000, mint: M3});

  const filter = trendingCursorFilter({score: 4.2, vol: 9000, mint: M3});
  assert.match(filter ?? "", /vol_24h\.lt\.9000/);
  assert.match(filter ?? "", /vol_24h\.eq\.9000,mint\.lt\./);
});

test("legacy two-part trending cursor still parses", () => {
  const parsed = parseTrendingCursor(`3.5|${M2}`);
  assert.equal(parsed.score, 3.5);
  assert.equal(parsed.vol, null);
  assert.equal(parsed.mint, M2);
});

test("trending feed floor drops sub-threshold and unpriced rows", () => {
  const small = stonk({id: M1, mint: M1, marketCapUsd: TRENDING_MIN_MCAP_USD - 1});
  const big = stonk({id: M2, mint: M2, marketCapUsd: TRENDING_MIN_MCAP_USD});
  const unpriced = stonk({id: M3, mint: M3, marketCapUsd: null});
  const kept = filterTrendingFeedStonks([small, big, unpriced]);
  assert.deepEqual(kept.map((s) => s.mint), [M2]);
});
