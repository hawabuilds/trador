/**
 * Pin the PumpSwap pool layout, and with it the answer to this project's
 * biggest open question.
 *
 * The plan carried a hypothesis: that pump.fun Custom Pairs lived in a
 * `bonding-curve-v2` account family, because the SDK derives those PDAs without
 * decoding them. That was wrong, and wrong in the direction that would have
 * been expensive — reading a guessed offset in the wrong account would have
 * classified every Custom Pair as SOL-quoted, mispricing each one by the whole
 * SOL/stock ratio while throwing nothing.
 *
 * The real answer: the bonding curve is SOL-only, and Custom Pairs are a
 * PumpSwap **AMM** feature. `Pool` carries `base_mint` and `quote_mint`
 * directly.
 *
 * Fixtures are finalized mainnet accounts: one real Custom Pair per stock that
 * had one, plus SOL-quoted controls at both live account sizes.
 */
import assert from "node:assert/strict";
import {test} from "node:test";

import {PUMPSWAP_POOL, WSOL_MINT} from "@/lib/programs";
import {DEFAULT_PUBKEY, isPubkey} from "@/lib/pubkey";
import {
  asCustomPair,
  decodeCustomPair,
  decodePumpPool,
  isCustomPair,
} from "@/lib/launchpad/pumpPool";
import {stockForTicker} from "@/lib/stocks/registry";

import FIXTURES from "./fixtures/pumpswap-pools.json" with {type: "json"};

interface Fixture {
  label: string;
  quoteTicker: string;
  pubkey: string;
  data: string;
  size: number;
}

const pools = FIXTURES.pools as Fixture[];
const customPairs = pools.filter((pool) => pool.quoteTicker !== "SOL");
const solQuoted = pools.filter((pool) => pool.quoteTicker === "SOL");

const bytesOf = (fixture: Fixture): Uint8Array =>
  Uint8Array.from(Buffer.from(fixture.data, "base64"));

test("fixtures cover real Custom Pairs and SOL-quoted controls", () => {
  assert.ok(customPairs.length > 0, "no Custom Pair fixtures");
  assert.ok(solQuoted.length > 0, "no SOL-quoted control fixtures");
});

/**
 * Both sizes are live, and this is the assertion that stops the expensive
 * mistake. 301 is current with 142,317 pools; 245 is legacy with 4,368.
 * Filtering on either one alone loses most of the program.
 */
test("both live account sizes decode with the same offsets", () => {
  const sizes = new Set(pools.map((pool) => bytesOf(pool).length));

  for (const size of sizes) {
    assert.ok(
      size === PUMPSWAP_POOL.SPAN || size === PUMPSWAP_POOL.LEGACY_SPAN,
      `unexpected pool size ${size} — the layout may have changed again`,
    );
  }

  for (const fixture of pools) {
    const pool = decodePumpPool(bytesOf(fixture));
    assert.ok(pool, `${fixture.label} (${fixture.size}B) did not decode`);
    assert.equal(pool.legacy, fixture.size === PUMPSWAP_POOL.LEGACY_SPAN);
  }
});

test("quote_mint is where the memcmp that found these accounts says it is", () => {
  for (const fixture of pools) {
    const pool = decodePumpPool(bytesOf(fixture))!;

    const expected =
      fixture.quoteTicker === "SOL"
        ? WSOL_MINT
        : stockForTicker(fixture.quoteTicker)!.mint;

    assert.equal(
      pool.quoteMint,
      expected,
      `${fixture.label}: quote mint offset disagrees with the filter that found it`,
    );
  }
});

test("the other offsets read distinct, well-formed addresses", () => {
  for (const fixture of pools) {
    const pool = decodePumpPool(bytesOf(fixture))!;

    for (const [label, value] of [
      ["creator", pool.creator],
      ["baseMint", pool.baseMint],
      ["quoteMint", pool.quoteMint],
      ["lpMint", pool.lpMint],
      ["baseTokenAccount", pool.baseTokenAccount],
      ["quoteTokenAccount", pool.quoteTokenAccount],
    ] as const) {
      assert.equal(isPubkey(value), true, `${fixture.label}: ${label} is not an address`);
      assert.notEqual(value, DEFAULT_PUBKEY, `${fixture.label}: ${label} read padding`);
    }

    // A shifted offset usually shows up as two fields reading the same bytes.
    const distinct = new Set([
      pool.baseMint,
      pool.quoteMint,
      pool.lpMint,
      pool.baseTokenAccount,
      pool.quoteTokenAccount,
    ]);
    assert.equal(distinct.size, 5, `${fixture.label}: two offsets overlap`);
  }
});

test("a Custom Pair resolves to the stock it is priced in", () => {
  for (const fixture of customPairs) {
    const pair = decodeCustomPair(bytesOf(fixture));
    assert.ok(pair, `${fixture.label}: not recognised as a Custom Pair`);
    assert.equal(pair.stock.ticker, fixture.quoteTicker);
    // The coin side really is a pump.fun coin.
    assert.equal(isPubkey(pair.pool.baseMint), true);
  }
});

test("a SOL-quoted pool is not a Custom Pair", () => {
  for (const fixture of solQuoted) {
    const pool = decodePumpPool(bytesOf(fixture))!;
    assert.equal(pool.quoteMint, WSOL_MINT);
    assert.equal(asCustomPair(pool), null);
    assert.equal(decodeCustomPair(bytesOf(fixture)), null);
  }
});

test("stock-pairing is three-state, so an unverified issuer does not hide a coin", () => {
  const custom = decodePumpPool(bytesOf(customPairs[0]))!;
  const sol = decodePumpPool(bytesOf(solQuoted[0]))!;
  const knownNonStocks = new Set<string>([WSOL_MINT]);

  assert.equal(isCustomPair(custom, knownNonStocks), true);
  assert.equal(isCustomPair(sol, knownNonStocks), false);

  // A quote mint that is neither a verified stock nor a known non-stock is
  // unevaluated, not "no". It may be a real stock from an issuer the registry
  // has yet to verify, and null keeps the coin visible.
  const unknown = {...custom, quoteMint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ" as typeof custom.quoteMint};
  assert.equal(isCustomPair(unknown, knownNonStocks), null);
});

test("malformed account data is rejected rather than half-decoded", () => {
  const real = bytesOf(pools[0]);

  assert.equal(decodePumpPool(real.subarray(0, 200)), null);
  assert.equal(decodePumpPool(new Uint8Array(0)), null);
  // Right size, all zeroes: every field would decode to the all-ones sentinel.
  assert.equal(decodePumpPool(new Uint8Array(PUMPSWAP_POOL.SPAN)), null);
  assert.equal(decodePumpPool(new Uint8Array(PUMPSWAP_POOL.LEGACY_SPAN)), null);
  // A size between the two is not a layout this decoder knows.
  assert.equal(decodePumpPool(new Uint8Array(280)), null);
});
