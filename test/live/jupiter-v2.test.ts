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

import {assertPubkey} from "@/lib/pubkey";
import {WSOL_MINT} from "@/lib/programs";
import {buildSwap, quote} from "@/lib/server/live/jupiter";
import {JUPITER_API_BASE, JUPITER_SWAP_PATH} from "@/lib/server/live/jupiterEnv";
import {simulateSwapTransaction} from "@/lib/server/live/simulateSwap";

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

describe("Jupiter Swap v2", {skip: !live}, () => {
  it("is the version the app calls", () => {
    assert.equal(JUPITER_SWAP_PATH, "/swap/v2");
    // lite-api serves v1 only, so a keyless host cannot answer these calls.
    assert.match(JUPITER_API_BASE, /api\.jup\.ag/);
  });

  it("quotes, builds and simulates a buy", async () => {
    const priced = await quote({
      inputMint: WSOL_MINT,
      outputMint: SPYX,
      amount: "150000000",
      slippageBps: 300,
    });

    assert.ok(Number(priced.outAmount) > 0, "router returned no output");
    assert.equal(priced.inputMint, WSOL_MINT);

    const built = await buildSwap({quote: priced, userPublicKey: FUNDED});
    assert.ok(built.transactionBase64.length > 0);

    const simulation = await simulateSwapTransaction(built.transactionBase64);
    assert.equal(
      simulation.ok,
      true,
      simulation.ok ? "" : `${simulation.message}\n${simulation.logs.slice(-5).join("\n")}`,
    );
  });
});
