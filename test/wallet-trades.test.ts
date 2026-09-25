import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";

import type {ParsedTx} from "@/lib/server/live/helius";
import {
  SOL_MINT,
  holdingProfit,
  portfolioUnrealizedPnl,
  positionsFrom,
  signedMoney,
  tradesFromTx,
  valueTrade,
  type Position,
} from "@/lib/walletTrades";

const ALLINU = "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8";
const SHOEDOG = "SkA82maVyUBgt4HUvMTLRDGyXX1yJpAsMNPhxEeSTNK";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** One real wallet's whole history, newest first, trimmed to what is read. */
const {wallet, transactions} = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/wallet-swaps.json"), "utf8"),
) as {wallet: string; transactions: (ParsedTx & {type: string})[]};

const [shoedogBuy, usdcToSol, allinuSell, allinuBuy, deposit] = transactions;

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("a buy the provider labelled TRANSFER is a buy, paid in SOL net of fee and rent", () => {
  assert.equal(allinuBuy.type, "TRANSFER");
  const [trade, ...rest] = tradesFromTx(allinuBuy, wallet);
  assert.equal(rest.length, 0);
  assert.equal(trade.mint, ALLINU);
  assert.equal(trade.side, "buy");
  close(trade.amount, 332.652094);
  assert.equal(trade.paidMint, SOL_MINT);
  // 0.051584286 left the wallet: 0.0000095 fee, 0.0015748 rent, 0.05 the coin.
  close(trade.paidAmount, 0.05);
});

test("a sell labelled INITIALIZE_ACCOUNT pairs with the USDC, not the fee SOL", () => {
  assert.equal(allinuSell.type, "INITIALIZE_ACCOUNT");
  const trades = tradesFromTx(allinuSell, wallet);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].side, "sell");
  assert.equal(trades[0].mint, ALLINU);
  assert.equal(trades[0].paidMint, USDC);
  close(trades[0].paidAmount, 5.92043);
});

test("a USDC-to-SOL swap records the SOL received", () => {
  const [trade] = tradesFromTx(usdcToSol, wallet);
  assert.equal(trade.mint, SOL_MINT);
  assert.equal(trade.side, "buy");
  assert.equal(trade.paidMint, USDC);
  close(trade.paidAmount, 5.92043);
  close(trade.amount, 0.060433132);
});

test("a buy that opened token accounts keeps their rent out of the price", () => {
  const [trade] = tradesFromTx(shoedogBuy, wallet);
  assert.equal(trade.mint, SHOEDOG);
  close(trade.amount, 124483.183716);
  // 0.093715795 left: the fee, two account deposits, and exactly 0.09 of SOL
  // that the pool side of the transaction received.
  close(trade.paidAmount, 0.09);
});

test("collecting pool fees into a freshly opened account is not a buy", () => {
  // The wallet paid rent to open an empty token account of its own, then
  // collected stock from a pool. Read naively that is 19 SPCXx bought for
  // 0.0015748 SOL — fifteen cents for $2,856 — which would be wildly wrong.
  const claim = JSON.parse(
    readFileSync(join(process.cwd(), "test/fixtures/wallet-fee-claim.json"), "utf8"),
  ) as {wallet: string; transaction: ParsedTx};
  assert.deepEqual(tradesFromTx(claim.transaction, claim.wallet), []);

  // And the instructions are what tell it apart: without them it is misread.
  const blind = {...claim.transaction, instructions: []};
  assert.equal(tradesFromTx(blind, claim.wallet).length, 1);
});

test("a plain deposit is not a trade", () => {
  assert.deepEqual(tradesFromTx(deposit, wallet), []);
  assert.deepEqual(tradesFromTx({...allinuBuy, transactionError: {code: 1}}, wallet), []);
});

test("dollar values: stables at face, SOL at its price then, anything else unknown", () => {
  const [sell] = tradesFromTx(allinuSell, wallet);
  close(valueTrade(sell, null).valueUsd!, 5.92043);

  const [buy] = tradesFromTx(allinuBuy, wallet);
  const priced = valueTrade(buy, 100);
  close(priced.valueUsd!, 5);
  close(priced.priceUsd!, 5 / 332.652094);
  assert.equal(valueTrade(buy, null).valueUsd, null);

  const tokenForToken = {...buy, paidMint: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg", paidAmount: 1};
  assert.equal(valueTrade(tokenForToken, 100).valueUsd, null);
});

const t = (at: number, side: "buy" | "sell", amount: number, valueUsd: number | null) => ({
  mint: SHOEDOG,
  side,
  amount,
  valueUsd,
  at: new Date(Date.UTC(2026, 8, 16, at)).toISOString(),
});

test("average cost survives partial sells, in any input order", () => {
  const [position] = positionsFrom([
    t(3, "sell", 50, 40),
    t(1, "buy", 100, 10),
    t(2, "buy", 100, 30),
  ]);
  // 200 units for $40, then half sold: 100 left carrying $20.
  close(position.qty, 150);
  close(position.costUsd, 30);
  assert.equal(position.complete, true);
});

test("SOL and stables never become positions", () => {
  assert.deepEqual(
    positionsFrom([{mint: SOL_MINT, side: "buy", amount: 1, valueUsd: 100, at: "2026-09-16T00:00:00Z"}]),
    [],
  );
});

test("an unpriced buy or an oversell makes the position partial", () => {
  assert.equal(positionsFrom([t(1, "buy", 10, null)])[0].complete, false);
  assert.equal(positionsFrom([t(1, "buy", 10, 5), t(2, "sell", 20, 9)])[0].complete, false);
});

const position = (qty: number, costUsd: number, complete = true): Position => ({
  mint: SHOEDOG,
  qty,
  costUsd,
  complete,
});

test("profit is what the holding is worth now minus what it cost", () => {
  assert.deepEqual(holdingProfit(100, 25, position(100, 9)), {usd: 16, partial: false});
  assert.deepEqual(holdingProfit(100, 5, position(100, 9)), {usd: -4, partial: false});
});

test("units that arrived without a purchase are left out and flagged", () => {
  // Bought 100 for $10, hold 200 worth $40: only the bought half is measured.
  assert.deepEqual(holdingProfit(200, 40, position(100, 10)), {usd: 10, partial: true});
  assert.equal(holdingProfit(100, 25, undefined), null);
  assert.equal(holdingProfit(100, null, position(100, 9)), null);
});

test("profit stays hidden when the history has quantity but no priced cost", () => {
  assert.equal(holdingProfit(50, 100, position(50, 0)), null);
});

test("tokenized stocks paid in another stock pick up spot when mintUsd is given", () => {
  const spcx = "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8";
  const msft = "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX";
  const mintUsd = new Map<string, number>([[spcx, 50]]);
  const buy = valueTrade(
    {
      signature: "sig",
      at: "2026-09-16T12:00:00Z",
      mint: msft,
      side: "buy",
      amount: 2,
      paidMint: spcx,
      paidAmount: 1,
    },
    null,
    mintUsd,
  );
  close(buy.valueUsd!, 50);
});

test("portfolio unrealized P&L sums holdings with positions and skips the rest", () => {
  const mintA = SHOEDOG;
  const mintB = ALLINU;
  const positions = new Map<string, Position>([
    [mintA, position(100, 9)],
    [mintB, position(50, 20)],
  ]);
  const total = portfolioUnrealizedPnl(
    [
      {mint: mintA, amount: 100, valueUsd: 25},
      {mint: mintB, amount: 50, valueUsd: 30},
      {mint: USDC, amount: 10, valueUsd: 100},
      {mint: mintA, amount: 5, valueUsd: null},
    ],
    positions,
  );
  assert.deepEqual(total, {usd: 16 + 10, pct: ((16 + 10) / (9 + 20)) * 100, partial: false});
  assert.equal(
    portfolioUnrealizedPnl([{mint: mintA, amount: 100, valueUsd: 25}], new Map()),
    null,
  );
});

test("profit reads as signed dollars", () => {
  assert.equal(signedMoney(16.52), "+$16.52");
  assert.equal(signedMoney(-3.1), "−$3.10");
  assert.equal(signedMoney(0), "+$0.00");
  assert.equal(signedMoney(0.0042), "+$0.0042");
  assert.equal(signedMoney(1234.5), "+$1,234.50");
});
