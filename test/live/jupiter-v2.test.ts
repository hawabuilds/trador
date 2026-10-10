/**
 * Jupiter Swap v2, against mainnet.
 *
 * Opt-in (`npm run test:live`), because it talks to the router and an RPC and
 * would otherwise make `npm test` depend on both being up.
 *
 * It exists because the v1-to-v2 move cannot be proved by types. v1 and v2
 * differ in one way that matters and is invisible until a transaction lands:
 * v1 rejects a fee account whose mint is the input of the trade. So this
 * quotes, builds and *simulates* — never sends — and asserts the router
 * returned something the chain accepts.
 */
import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Connection, PublicKey, VersionedTransaction} from "@solana/web3.js";

import {assertPubkey, type Pubkey} from "@/lib/pubkey";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {buildSwap, quote} from "@/lib/server/live/jupiter";
import {JUPITER_API_BASE, JUPITER_SWAP_PATH} from "@/lib/server/live/jupiterEnv";
import {feeAmountFor, feeLegFor} from "@/lib/server/live/platformFee";
import {simulateSwapTransaction} from "@/lib/server/live/simulateSwap";
import {serverRpcUrl} from "@/lib/server/rpcUrl";

const live = process.env.TRADOR_LIVE_TESTS === "1";

const SPYX = assertPubkey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "SPYx");

/**
 * A wallet that holds plenty of SOL, used only as the simulated signer.
 *
 * Simulation needs a funded account or it fails for a reason that has nothing
 * to do with what is being tested. Nothing is signed and nothing is sent, so
 * this is a read of public state.
 */
const FUNDED = assertPubkey(
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
  "simulated signer",
);

/**
 * One router call at a time, spaced out.
 *
 * The suite fires a handful of quotes, and Jupiter rate limits hard enough that
 * running them together fails every one of them for a reason that has nothing
 * to do with fees.
 */
const GAP_MS = 1_200;
let turn: Promise<unknown> = Promise.resolve();

function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(async () => {
    const value = await work();
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    return value;
  });
  turn = next.catch(() => undefined);
  return next;
}

/** An SPL token account's balance sits at a fixed offset in its data. */
const TOKEN_AMOUNT_OFFSET = 64;

function tokenAmount(data: Buffer): bigint {
  return data.readBigUInt64LE(TOKEN_AMOUNT_OFFSET);
}

/** What a token account gains if this transaction runs. Simulated, never sent. */
async function simulatedTokenDelta(
  account: Pubkey,
  transactionBase64: string,
): Promise<bigint> {
  const connection = new Connection(serverRpcUrl(), "confirmed");
  const address = new PublicKey(account);

  const before = await connection.getAccountInfo(address);
  assert.ok(before, "the collection account must already exist");

  const simulated = await connection.simulateTransaction(
    VersionedTransaction.deserialize(Buffer.from(transactionBase64, "base64")),
    {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: {encoding: "base64", addresses: [account]},
    },
  );

  assert.equal(
    simulated.value.err,
    null,
    `simulation failed: ${JSON.stringify(simulated.value.err)}\n${(simulated.value.logs ?? []).slice(-5).join("\n")}`,
  );

  const after = simulated.value.accounts?.[0];
  assert.ok(after, "simulation returned no account state");

  return tokenAmount(Buffer.from(after.data[0], "base64")) - tokenAmount(before.data);
}

/** A wallet that holds enough of a mint to simulate selling some. */
async function largestHolderOf(mint: Pubkey): Promise<Pubkey> {
  const connection = new Connection(serverRpcUrl(), "confirmed");
  const largest = await connection.getTokenLargestAccounts(new PublicKey(mint));
  const account = largest.value.find((entry) => Number(entry.amount) > 20_000_000);
  assert.ok(account, "no holder large enough to simulate a sell");
  const parsed = await connection.getParsedAccountInfo(account.address);
  const data = parsed.value?.data;
  assert.ok(data && "parsed" in data, "holder account did not parse");
  return assertPubkey(data.parsed.info.owner, "holder");
}

describe("Jupiter Swap v2", {skip: !live}, () => {
  it("is the version the app calls", () => {
    assert.equal(JUPITER_SWAP_PATH, "/swap/v2");
    // lite-api serves v1 only, so a keyless host cannot answer these calls.
    assert.match(JUPITER_API_BASE, /api\.jup\.ag/);
  });

  it("quotes, builds and simulates a buy", async () => {
    const priced = await inTurn(() =>
      quote({
        inputMint: WSOL_MINT,
        outputMint: SPYX,
        amount: "150000000",
        slippageBps: 300,
      }),
    );

    assert.ok(Number(priced.outAmount) > 0, "router returned no output");
    assert.equal(priced.inputMint, WSOL_MINT);

    const built = await inTurn(() => buildSwap({quote: priced, userPublicKey: FUNDED}));
    assert.ok(built.transactionBase64.length > 0);

    const simulation = await simulateSwapTransaction(built.transactionBase64);
    assert.equal(
      simulation.ok,
      true,
      simulation.ok ? "" : `${simulation.message}\n${simulation.logs.slice(-5).join("\n")}`,
    );
  });
});

/**
 * The fee the ticket prints, against the fee the chain actually moves.
 *
 * This is the test the whole fee design rests on. `feeAmountFor` claims to know
 * what a trade will charge; the only way to check that is to build the
 * transaction, simulate it, and read what the collection account gained. All
 * four legs are covered because each one is a different code path: money on the
 * input for buys, money on the output for sells, in two different mints.
 *
 * The accounts below belong to exchanges, not to Trador. They stand in for a
 * vault purely because they exist and hold the right mints. Nothing is signed
 * and nothing is sent.
 */
describe("the fee the ticket shows is the fee the chain moves", {skip: !live}, () => {
  const USDC_ACCOUNT = assertPubkey(
    "9KaA7vEBUdRCcBWxfuMjxYwKfvu8Us3Cg5gkhVFt2LNk",
    "stand-in USDC collector",
  );
  const WSOL_ACCOUNT = assertPubkey(
    "ERcud5EoLBYq8nwHgutsSsniyEJ8LhhMHgRp9V37WvDW",
    "stand-in wSOL collector",
  );

  const BPS = 50;
  const SLIPPAGE_BPS = 300;

  async function feeDelta(params: {
    inputMint: Pubkey;
    outputMint: Pubkey;
    amount: string;
    taker: Pubkey;
    feeAccount: Pubkey;
  }): Promise<{moved: bigint; shown: string | null; mint: Pubkey}> {
    const leg = feeLegFor(params);
    assert.ok(leg, "this pair should have a money leg");

    const priced = await inTurn(() =>
      quote({
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: SLIPPAGE_BPS,
        feeAccount: params.feeAccount,
        feeBps: BPS,
      }),
    );

    const shown = feeAmountFor({
      fee: {side: leg.side, bps: BPS},
      inAmount: priced.inAmount,
      quotedFeeAmount: priced.platformFee?.amount ?? null,
    });

    const built = await inTurn(() =>
      buildSwap({
        quote: priced,
        userPublicKey: params.taker,
        feeAccount: params.feeAccount,
      }),
    );

    const moved = await simulatedTokenDelta(params.feeAccount, built.transactionBase64);
    return {moved, shown, mint: leg.mint};
  }

  it("charges a USDC buy out of the USDC spent", async () => {
    const {moved, shown, mint} = await feeDelta({
      inputMint: USDC_MINT,
      outputMint: SPYX,
      amount: "25000000",
      taker: FUNDED,
      feeAccount: USDC_ACCOUNT,
    });
    assert.equal(mint, USDC_MINT);
    assert.equal(moved.toString(), shown);
    assert.equal(moved.toString(), "125000");
  });

  it("charges a SOL buy out of the SOL spent", async () => {
    const {moved, shown, mint} = await feeDelta({
      inputMint: WSOL_MINT,
      outputMint: SPYX,
      amount: "150000000",
      taker: FUNDED,
      feeAccount: WSOL_ACCOUNT,
    });
    assert.equal(mint, WSOL_MINT);
    assert.equal(moved.toString(), shown);
    assert.equal(moved.toString(), "750000");
  });

  /**
   * A sell's fee is a share of what the trade actually pays out, so it moves
   * with execution exactly as the payout does — the quote's figure is the same
   * kind of estimate as the quoted output, and the ticket already says so with
   * "Minimum received". A buy's fee is a share of a fixed input, so that one is
   * exact and asserted as such above.
   */
  function assertWithinSlippage(moved: bigint, shown: string | null): void {
    assert.ok(shown, "nothing was shown to compare against");
    const quoted = BigInt(shown);
    const tolerance = (quoted * BigInt(SLIPPAGE_BPS)) / 10_000n;
    const drift = moved > quoted ? moved - quoted : quoted - moved;
    assert.ok(
      drift <= tolerance,
      `fee moved ${moved} against ${quoted} shown, drift ${drift} over tolerance ${tolerance}`,
    );
  }

  it("charges a sell out of the USDC received", async () => {
    const seller = await largestHolderOf(SPYX);
    const {moved, shown, mint} = await feeDelta({
      inputMint: SPYX,
      outputMint: USDC_MINT,
      amount: "2000000",
      taker: seller,
      feeAccount: USDC_ACCOUNT,
    });
    assert.equal(mint, USDC_MINT);
    assert.ok(moved > 0n, "a sell should pay some fee");
    assertWithinSlippage(moved, shown);
  });

  it("charges a sell out of the SOL received", async () => {
    const seller = await largestHolderOf(SPYX);
    const {moved, shown, mint} = await feeDelta({
      inputMint: SPYX,
      outputMint: WSOL_MINT,
      amount: "2000000",
      taker: seller,
      feeAccount: WSOL_ACCOUNT,
    });
    assert.equal(mint, WSOL_MINT);
    assert.ok(moved > 0n, "a sell should pay some fee");
    assertWithinSlippage(moved, shown);
  });
});
