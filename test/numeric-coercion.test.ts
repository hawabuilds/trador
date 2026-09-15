/**
 * Postgres `numeric` reaches this app as a string, and nothing says so.
 *
 * The two drivers disagree: PostgREST returns JSON numbers, node-postgres
 * returns strings, because `numeric` is arbitrary precision and a float would
 * not always round-trip. The same column is therefore `0.62` on one path and
 * `"0.62"` on the other, and a string survives every truthiness check between
 * the query and the screen before failing the one that matters.
 *
 * This has now shipped twice. Once as a Stonkfolio balance chart that rendered
 * flat, and again — after that was fixed *and commented* — as a Graduating tab
 * where every progress bar was invisible, because `Number.isFinite("0.62")` is
 * false. Both were caught by looking at the screen, which is the wrong way to
 * catch an arithmetic bug.
 */

import {strict as assert} from "node:assert";
import {test} from "node:test";

import {rowToStonk} from "@/lib/server/live/universeStore";
import type {StonkRow} from "@/lib/server/live/universeStore";

/** A row as node-postgres hands it over: every `numeric` a string. */
function pgRow(overrides: Partial<Record<string, unknown>> = {}): StonkRow {
  return {
    mint: "Ddd4Qy8N5nNtteaHfESfmjsynz5qEGFQZMLQuLj49EzL",
    launchpad: "stonkfun",
    pool: "rjXcJVEhXHCTQiZYkbTq6Nd8odDjJ6VtFpudxiied1A",
    platform_config: null,
    config_kind: null,
    creator: null,
    symbol: "RICH",
    name: "RICH OFF GTA 6",
    decimals: 6,
    token_program: null,
    quote_mint: "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo",
    quote_ticker: "TTWO",
    quote_kind: "stock",
    pays_holders: true,
    reward_stock: "TTWO",
    circulating_supply: null,
    status: "pending",
    eligible: true,
    is_tradeable: null,
    is_custom_pair: null,
    curve_progress: null,
    image_url: null,
    image_source: null,
    twitter: null,
    telegram: null,
    website: null,
    listed_at: null,
    ...overrides,
  } as unknown as StonkRow;
}

test("a numeric arriving as a string becomes a number", () => {
  const stonk = rowToStonk(
    pgRow({curve_progress: "0.627881", circulating_supply: "999600000"}),
    null,
  );

  assert.equal(typeof stonk.curveProgress, "number");
  assert.equal(stonk.curveProgress, 0.627881);
  assert.equal(stonk.circulatingSupply, 999_600_000);

  /*
   * The assertion that would have caught the shipped bug. The progress bar
   * renders nothing unless this passes, and a string fails it while looking
   * perfectly reasonable in a JSON payload.
   */
  assert.equal(Number.isFinite(stonk.curveProgress), true);
});

test("a numeric arriving as a number is left alone", () => {
  const stonk = rowToStonk(pgRow({curve_progress: 0.42}), null);
  assert.equal(stonk.curveProgress, 0.42);
});

/**
 * Null is not zero, on either path.
 *
 * Unmeasured progress rendered as 0% would say "nobody has bought this", which
 * is a claim about the coin rather than about our data.
 */
test("null and unparseable stay null, never zero", () => {
  assert.equal(rowToStonk(pgRow({curve_progress: null}), null).curveProgress, null);
  assert.equal(rowToStonk(pgRow({curve_progress: undefined}), null).curveProgress, null);
  assert.equal(rowToStonk(pgRow({curve_progress: "NaN"}), null).curveProgress, null);
  assert.equal(rowToStonk(pgRow({curve_progress: ""}), null).curveProgress, null);
});
