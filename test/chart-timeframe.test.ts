import {strict as assert} from "node:assert";
import {test} from "node:test";

import {defaultChartTimeframe, YOUNG_LISTING_MS} from "@/lib/chartTimeframe";

test("pending stonks default to 1m without a URL timeframe", () => {
  assert.equal(
    defaultChartTimeframe({kind: "stonk", coinStatus: "pending", listedAt: null}),
    "1m",
  );
});

test("URL timeframe wins over pending default", () => {
  assert.equal(
    defaultChartTimeframe({
      kind: "stonk",
      coinStatus: "pending",
      requested: "1h",
    }),
    "1h",
  );
});

test("young listed stonks still default to 1m", () => {
  const now = Date.now();
  const listedAt = new Date(now - YOUNG_LISTING_MS / 2).toISOString();
  assert.equal(
    defaultChartTimeframe({kind: "stonk", coinStatus: "listed", listedAt, now}),
    "1m",
  );
});

test("older listed stonks default to 1h", () => {
  const now = Date.now();
  const listedAt = new Date(now - YOUNG_LISTING_MS * 2).toISOString();
  assert.equal(
    defaultChartTimeframe({kind: "stonk", coinStatus: "listed", listedAt, now}),
    "1h",
  );
});
