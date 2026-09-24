import assert from "node:assert/strict";
import {describe, it} from "node:test";

import type {BalancePoint} from "@/components/BalanceChart";
import {balancePointsWithLive} from "@/hooks/useBalanceHistory";

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
