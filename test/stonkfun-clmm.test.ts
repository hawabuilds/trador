import assert from "node:assert/strict";
import {test} from "node:test";

import {
  CLMM_MINTS_SLICE,
  CLMM_POOL,
  decodeClmmLaunch,
  stonkfunClmmFilters,
} from "@/lib/launchpad/stonkfunClmm";
import {RAYDIUM_CLMM, STONKFUN_LAUNCHER} from "@/lib/programs";
import {type Pubkey, decodeBase58} from "@/lib/pubkey";
import {stockForTicker} from "@/lib/stocks/registry";

/*
 * StonkFun's direct CLMM launches.
 *
 * Pinned against the two coins that were reported missing, with their real
 * mints and pools, because every way this goes wrong is quiet: a wrong offset
 * or a swapped side still decodes to *something*, and the feed fills with
 * coins labelled as priced in the wrong stock, or with stocks listed as coins.
 */

const ALICE = "2hkhFLWQKUcvUNh7eUkfZVz3rYfxXqFNeVLYMotrzFky" as Pubkey;
const BUTTHOLE = "7ssJZGFT3twGqeYA1kvpoMWwZYvMZvrMEbjRaWgg46BL" as Pubkey;
const SOL = "So11111111111111111111111111111111111111112" as Pubkey;

function slice(first: string, second: string): Uint8Array {
  const a = decodeBase58(first);
  const b = decodeBase58(second);
  assert.ok(a && b, "test fixture mints must be valid base58");
  const out = new Uint8Array(64);
  out.set(a, 0);
  out.set(b, 32);
  return out;
}

const vidax = stockForTicker("VIDAx");
const anthropic = stockForTicker("ANTHROPIC");

test("the stocks both reported coins are priced in are registered", () => {
  // VIDAx was the half of this bug that lived in the registry, not the indexer.
  assert.ok(vidax, "VIDAx must be in the verified registry");
  assert.ok(anthropic, "ANTHROPIC must be in the verified registry");
});

test("ALICE decodes as a coin priced in VIDAx, whichever side the stock is on", () => {
  // On chain the pool stores VIDAx first, because mints are ordered by address.
  const pool = "2dSF7bEDi5mYxtk6smwu3Rs2D33g6Urt2raTRHJ83y9U" as Pubkey;

  for (const bytes of [slice(vidax!.mint, ALICE), slice(ALICE, vidax!.mint)]) {
    const launch = decodeClmmLaunch(pool, bytes);
    assert.equal(launch?.mint, ALICE);
    assert.equal(launch?.quote.ticker, "VIDAx");
    assert.equal(launch?.pool, pool);
  }
});

test("BUTTHOLE decodes as a coin priced in ANTHROPIC", () => {
  const launch = decodeClmmLaunch(
    "HX72xZ1CHg7cWPhGGJyHbLp3sLrpznTYmWn5AY3FVwUj" as Pubkey,
    slice(anthropic!.mint, BUTTHOLE),
  );
  assert.equal(launch?.mint, BUTTHOLE);
  assert.equal(launch?.quote.ticker, "ANTHROPIC");
});

test("a pool with no verified stock on either side is not a launch", () => {
  assert.equal(decodeClmmLaunch(ALICE, slice(SOL, ALICE)), null);
});

test("a pool between two stocks is a market, not a launch", () => {
  // Listing either side as a "coin" would put a real equity in the coin feed.
  assert.equal(decodeClmmLaunch(ALICE, slice(vidax!.mint, anthropic!.mint)), null);
});

test("a short slice is refused rather than read past its end", () => {
  assert.equal(decodeClmmLaunch(ALICE, new Uint8Array(40)), null);
});

test("the scan selects StonkFun's pools by creator, on the right program", () => {
  assert.equal(CLMM_POOL.PROGRAM, RAYDIUM_CLMM);
  assert.deepEqual(stonkfunClmmFilters(), [
    {dataSize: 1544},
    {memcmp: {offset: 41, bytes: STONKFUN_LAUNCHER}},
  ]);
  // Both mints and nothing else, starting at token_mint_0.
  assert.deepEqual(CLMM_MINTS_SLICE, {offset: 73, length: 64});
});
