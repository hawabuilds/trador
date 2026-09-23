import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

import {mergeTradesIntoChart} from "@/lib/chartLive";
import {fillFromTx, mergeTape, type ParsedTx} from "@/lib/server/live/chainTape";
import type {ChartPoint, Trade} from "@/lib/types";

const COIN = "SkA82maVyUBgt4HUvMTLRDGyXX1yJpAsMNPhxEeSTNK"; // SHOEDOG
const NKE = "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg";
const NKE_USD = 36;

/** Real routed swaps against SHOEDOG's Raydium CPMM pool, trimmed. */
const [jupiterBuy, routedSell, twoPoolSell] = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/shoedog-swaps.json"), "utf8"),
) as ParsedTx[];

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) / expected < 1e-9, `${actual} != ${expected}`);

test("a Jupiter-routed buy is read from the pool's vaults, not the router", () => {
  const fill = fillFromTx(jupiterBuy, COIN, NKE, NKE_USD);
  assert.ok(fill);
  assert.equal(fill.side, "buy");
  // What left the pool — the buyer received 1% less to SHOEDOG's transfer fee.
  close(fill.amount, 60538.479338);
  close(fill.amountUsd, 0.402003 * NKE_USD);
  close(fill.priceUsd, (0.402003 * NKE_USD) / 60538.479338);
  assert.equal(fill.maker, jupiterBuy.feePayer);
  assert.equal(fill.txHash, jupiterBuy.signature);
});

test("coin arriving in the pool is a sell", () => {
  const fill = fillFromTx(routedSell, COIN, NKE, NKE_USD);
  assert.ok(fill);
  assert.equal(fill.side, "sell");
  close(fill.amount, 18469.872323);
  close(fill.amountUsd, 0.116019 * NKE_USD);
});

test("a second pool in the route is not mistaken for ours", () => {
  // Constant-product pools on one AMM share an authority. Make the other pool
  // in this route look exactly like ours by owner: its NKE moves the wrong way
  // for our coin's movement, so it must still be ignored.
  const shared = structuredClone(twoPoolSell);
  const authority = "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL";
  const changes = shared.accountData!.flatMap((a) => a.tokenBalanceChanges ?? []);
  for (const change of changes) {
    if (change.mint === NKE) change.userAccount = authority;
    if (change.mint === COIN && change.userAccount !== shared.feePayer) change.userAccount = authority;
  }
  // And list the other pool's NKE first, so only the sign can tell them apart.
  const wrongWay = changes.filter(
    (c) => c.mint === NKE && Number(c.rawTokenAmount.tokenAmount) > 0,
  );
  // In the real route it passed the same NKE straight through; give it a
  // different size so reading the wrong vault would show up in the price.
  for (const decoy of wrongWay) decoy.rawTokenAmount.tokenAmount = "5000000";
  shared.accountData = [
    {tokenBalanceChanges: [...wrongWay, ...changes.filter((c) => !wrongWay.includes(c))]},
  ];
  const firstNke = shared.accountData[0].tokenBalanceChanges!.find((c) => c.mint === NKE)!;
  assert.ok(
    Number(firstNke.rawTokenAmount.tokenAmount) > 0,
    "the wrong-signed vault must come first for this test to mean anything",
  );
  const fill = fillFromTx(shared, COIN, NKE, NKE_USD);
  assert.ok(fill);
  assert.equal(fill.side, "sell");
  close(fill.amountUsd, 8.862419 * NKE_USD);
});

test("a failed transaction, or one without our pool's other side, is no fill", () => {
  assert.equal(fillFromTx({...jupiterBuy, transactionError: {code: 1}}, COIN, NKE, NKE_USD), null);
  // Wrong other mint: the vault pair is not this pool.
  assert.equal(
    fillFromTx(jupiterBuy, COIN, "So11111111111111111111111111111111111111112", 100),
    null,
  );
});

test("bonding-curve fills are read from the signer's token accounts", () => {
  const buyer = "Buyer111111111111111111111111111111111111111";
  const curveBuy: ParsedTx = {
    signature: "curve-buy-sig",
    timestamp: 1_700_000_000,
    feePayer: buyer,
    accountData: [
      {
        tokenBalanceChanges: [
          {
            userAccount: buyer,
            tokenAccount: "",
            mint: COIN,
            rawTokenAmount: {tokenAmount: "1000000", decimals: 6},
          },
          {
            userAccount: buyer,
            tokenAccount: "",
            mint: NKE,
            rawTokenAmount: {tokenAmount: "-50000", decimals: 6},
          },
        ],
      },
    ],
  };
  const fill = fillFromTx(curveBuy, COIN, NKE, NKE_USD);
  assert.ok(fill);
  assert.equal(fill.side, "buy");
  close(fill.amount, 1);
  close(fill.amountUsd, 0.05 * NKE_USD);
});

function trade(txHash: string, at: string, priceUsd = 1, amountUsd = 10): Trade {
  return {
    id: `${txHash}:b`,
    side: "buy",
    amount: amountUsd / priceUsd,
    amountUsd,
    priceUsd,
    maker: "m",
    txHash,
    makerHandle: null,
    at,
  };
}

test("tape merge keeps one row per transaction, newest first", () => {
  const merged = mergeTape(
    [trade("c", "2026-09-16T20:03:00Z"), trade("b", "2026-09-16T20:02:00Z")],
    [trade("b", "2026-09-16T20:02:00Z"), trade("a", "2026-09-16T20:01:00Z")],
  );
  assert.deepEqual(merged.map((t) => t.txHash), ["c", "b", "a"]);
});

const MIN = 60_000;
const at = (minute: number) => new Date(Date.UTC(2026, 8, 16, 20, minute)).toISOString();
const candle = (minute: number, price: number): ChartPoint => ({
  t: Date.UTC(2026, 8, 16, 20, minute),
  price,
  open: price,
  high: price,
  low: price,
});

test("a complete tape redraws the candles it spans, filling the provider's holes", () => {
  // Provider: minutes 0 and 1, then nothing until 5.
  const indexed = [candle(0, 1), candle(1, 1.1), candle(5, 9)];
  // Chain: trades from inside minute 1 through minute 4.
  const tape = [
    trade("t1", at(1), 1.1),
    trade("t2", at(2), 1.2),
    trade("t3", at(3), 1.3),
    trade("t4", at(4), 1.4),
  ].reverse();

  const merged = mergeTradesIntoChart(indexed, tape, MIN, {complete: true});
  assert.deepEqual(
    merged.map((p) => [(p.t - indexed[0].t) / MIN, p.price]),
    // Minute 1 is only partly covered, so it stays; 2–4 come from the tape;
    // the provider's minute-5 candle has no fill behind it and is dropped.
    [[0, 1], [1, 1.1], [2, 1.2], [3, 1.3], [4, 1.4]],
  );
  // Each rebuilt candle opens at the previous close.
  assert.equal(merged[2].open, 1.1);
});

test("a partial tape still only appends after the last indexed candle", () => {
  const indexed = [candle(0, 1), candle(5, 2)];
  const tape = [trade("late", at(6), 2.1), trade("gap", at(3), 1.5)];
  const merged = mergeTradesIntoChart(indexed, tape, MIN);
  assert.deepEqual(
    merged.map((p) => (p.t - indexed[0].t) / MIN),
    [0, 5, 6],
  );
});
