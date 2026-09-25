import assert from "node:assert/strict";
import {describe, it} from "node:test";

import type {BalancePoint} from "@/components/BalanceChart";
import {balanceChangeForRange, balancePointsWithLive} from "@/hooks/useBalanceHistory";

describe("balancePointsWithLive", () => {
  it("pins the live total when history is empty", () => {
    const live: BalancePoint = {t: 1_000, value: 42};
    const points = balancePointsWithLive([], 42);
    assert.equal(points.length, 1);
    assert.equal(points[0].value, live.value);
  });

  it("returns snapshots unchanged when live total is unknown", () => {
    const snapshots: BalancePoint[] = [{t: 100, value: 10}];
    assert.deepEqual(balancePointsWithLive(snapshots, null), snapshots);
  });
});

describe("balanceChangeForRange", () => {
  it("uses live total vs range open when chart points collapsed to one", () => {
    const snapshots: BalancePoint[] = [{t: Date.now() - 5_000, value: 100}];
    const points = balancePointsWithLive(snapshots, 110);
    assert.equal(points.length, 1);
    const change = balanceChangeForRange(snapshots, 110, points);
    assert.deepEqual(change, {usd: 10, pct: 10});
  });

  it("returns null with no snapshots and only a live pin", () => {
    const points = balancePointsWithLive([], 50);
    assert.equal(balanceChangeForRange([], 50, points), null);
  });
});
