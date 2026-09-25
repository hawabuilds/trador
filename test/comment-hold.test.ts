import assert from "node:assert/strict";
import {test} from "node:test";

import {
  heldCommentPosition,
  MIN_POSITION_USD,
  resolveHeldUiAmount,
  uiAmountForMint,
  uiAmountHolds,
} from "@/lib/commentHold";
import {assertPubkey} from "@/lib/pubkey";

const MINT = assertPubkey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "mint");
const OTHER = assertPubkey("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "other");

test("a cent of a priced coin is a position; a fraction of a cent is dust", () => {
  assert.equal(uiAmountHolds(1, MIN_POSITION_USD), true);
  assert.equal(uiAmountHolds(0.5, MIN_POSITION_USD), false);
  assert.equal(uiAmountHolds(0, 10), false);
});

test("an unpriced coin counts any positive balance rather than refusing a holder", () => {
  assert.equal(uiAmountHolds(0.0001, null), true);
  assert.equal(uiAmountHolds(0, null), false);
});

test("the cache mint is matched exactly — never by folding case", () => {
  const byMint = new Map<string, number>([[MINT, 12], [OTHER, 99]]);
  assert.equal(uiAmountForMint(byMint, MINT), 12);
  assert.equal(uiAmountForMint(byMint, OTHER), 99);

  // The same letters in a different case are a different account.
  const folded = MINT.slice(0, 1).toLowerCase() + MINT.slice(1); // pubkey-lint-ok: proving a folded mint must not match
  const aliased = new Map<string, number>([[folded, 12]]);
  assert.equal(uiAmountForMint(aliased, MINT), 0);
});

test("comments trust a fresh Stonkfolio cache before hitting RPC", () => {
  const resolved = resolveHeldUiAmount({
    freshCache: 4,
    rpc: {ok: false},
    staleCache: undefined,
  });
  assert.deepEqual(resolved, {uiAmount: 4});
});

test("a fresh cache of zero is a real answer, not a miss that falls through", () => {
  const resolved = resolveHeldUiAmount({
    freshCache: 0,
    rpc: {ok: true, uiAmount: 9},
    staleCache: 9,
  });
  assert.deepEqual(resolved, {uiAmount: 0});
});

test("when RPC fails, a stale Stonkfolio cache still counts as holding", () => {
  const resolved = resolveHeldUiAmount({
    freshCache: undefined,
    rpc: {ok: false},
    staleCache: 3,
  });
  assert.deepEqual(resolved, {uiAmount: 3});
});

test("RPC failure with no cache is a hard miss, not 'not holding'", () => {
  const resolved = resolveHeldUiAmount({
    freshCache: undefined,
    rpc: {ok: false},
    staleCache: undefined,
  });
  assert.deepEqual(resolved, {failed: true});
});

test("a public comment can show Holding without inventing what they paid", () => {
  const position = heldCommentPosition();
  assert.equal(position.status, "holding");
  assert.equal(position.boughtUsd, 0);
  assert.equal(position.gainPct, null);
});
