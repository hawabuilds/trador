/**
 * DexScreener pair open time is the graduation clock for curve launches.
 */

import assert from "node:assert/strict";
import {test} from "node:test";

test("DexFill shape documents pairCreatedAt for graduation backfill", () => {
  // Compile-time contract: decorate and the backfill script both read this.
  const fill = {
    links: {},
    priceChange24h: null as number | null,
    imageUrl: null as string | null,
    pairCreatedAt: "2026-09-23T22:09:43.000Z" as string | null,
  };
  assert.equal(typeof fill.pairCreatedAt, "string");
  assert.ok(Date.parse(fill.pairCreatedAt!) < Date.parse("2026-09-24T19:15:26.616Z"));
});
