import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  actualWeights,
  assetSymbol,
  drift,
  equalTargets,
  normalizeTargets,
  planRebalanceWithTargets,
  pricedHoldings,
  rebalanceScore,
  targetsFromActual,
  targetsValid,
} from "@/lib/allocation";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import type {Pubkey} from "@/lib/pubkey";
import type {Holding, Stock} from "@/lib/types";

const MINT_A = USDC_MINT;
const MINT_B = WSOL_MINT;

function stock(mint: Pubkey, ticker: string, price: number, amount: number): Holding {
  const asset: Stock = {
    kind: "stock",
    id: ticker,
    mint,
    ticker,
    name: ticker,
    decimals: 6,
    price: {usd: price, source: "oracle", status: "priced", at: null},
    changePct: null,
    series: [],
    issuer: "backed",
    stockKind: "equity",
    priceAuthority: "pyth",
    sector: null,
    launchesQuotedAgainst: 0,
    marketCapUsd: null,
    description: null,
  };
  return {asset, amount, valueUsd: price * amount};
}

describe("allocation", () => {
  it("excludes unpriced holdings from weights", () => {
    const holdings = [
      stock(MINT_A, "AAA", 10, 1),
      {
        ...stock(MINT_B, "BBB", 5, 2),
        valueUsd: null,
      },
    ];
    assert.equal(pricedHoldings(holdings).length, 1);
    const weights = actualWeights(holdings);
    assert.equal(weights.length, 1);
    assert.equal(weights[0].weight, 100);
  });

  it("normalizes targets to sum to 100", () => {
    const mints = [MINT_A, MINT_B];
    const normalized = normalizeTargets({[mints[0]]: 30, [mints[1]]: 30}, mints);
    assert.equal(normalized[mints[0]], 50);
    assert.equal(normalized[mints[1]], 50);
  });

  it("validates target totals", () => {
    assert.equal(targetsValid({a: 50, b: 50}), true);
    assert.equal(targetsValid({a: 40, b: 50}), false);
  });

  it("plans sells for overweight and buys for underweight", () => {
    const holdings = [
      stock(MINT_A, "AAA", 10, 6),
      stock(MINT_B, "BBB", 10, 4),
    ];
    const targets = {
      [MINT_A]: 40,
      [MINT_B]: 60,
    };
    const rows = drift(holdings, targets);
    assert.ok(rebalanceScore(rows) > 0);

    const plan = planRebalanceWithTargets(holdings, targets);
    assert.equal(plan.sells.length, 1);
    assert.equal(plan.sells[0].side, "sell");
    assert.equal(assetSymbol(plan.sells[0].asset), "AAA");
    assert.equal(plan.buys.length, 1);
    assert.equal(plan.buys[0].side, "buy");
    assert.equal(assetSymbol(plan.buys[0].asset), "BBB");
  });

  it("marks sub-dollar legs as below minimum", () => {
    const holdings = [
      stock(MINT_A, "AAA", 100, 1),
      stock(MINT_B, "BBB", 100, 1),
    ];
    const targets = {
      [MINT_A]: 50.01,
      [MINT_B]: 49.99,
    };
    const plan = planRebalanceWithTargets(holdings, targets);
    assert.ok(plan.sells.every((leg) => leg.belowMinimum));
    assert.ok(plan.buys.every((leg) => leg.belowMinimum));
  });

  it("never plans a sell larger than the holding", () => {
    const holdings = [
      stock(MINT_A, "AAA", 10, 10),
      stock(MINT_B, "BBB", 10, 0.1),
    ];
    const targets = {
      [MINT_A]: 10,
      [MINT_B]: 90,
    };
    const plan = planRebalanceWithTargets(holdings, targets);
    const sell = plan.sells[0];
    assert.ok(sell.amountUsd <= 99);
  });

  it("seeds equal and actual targets", () => {
    const mints = [MINT_A, MINT_B];
    const equal = equalTargets(mints);
    assert.ok(targetsValid(equal));

    const holdings = [
      stock(mints[0], "AAA", 10, 3),
      stock(mints[1], "BBB", 10, 1),
    ];
    const actual = targetsFromActual(holdings);
    assert.ok(targetsValid(actual));
    assert.ok(actual[mints[0]] > actual[mints[1]]);
  });
});
