import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {WSOL_MINT} from "@/lib/programs";
import {
  feeCollectorFromEnv,
  platformFeePairEligible,
} from "@/lib/server/live/platformFee";
import {quoteWithoutPlatformFee} from "@/lib/server/live/jupiter";
import {assertPubkey} from "@/lib/pubkey";

const MSFT = assertPubkey(
  "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
  "MSFTx",
);
const STONK = assertPubkey(
  "FjTfaSH861nVcbAxdFAHTvhoSL4kyR6wgTWynuJkapht",
  "stonk",
);

describe("platformFeePairEligible", () => {
  it("allows wSOL fees on sells (token → SOL)", () => {
    assert.equal(
      platformFeePairEligible({inputMint: MSFT, outputMint: WSOL_MINT}),
      true,
    );
    assert.equal(
      platformFeePairEligible({inputMint: STONK, outputMint: WSOL_MINT}),
      true,
    );
  });

  it("skips wSOL fees on buys (SOL → token)", () => {
    assert.equal(
      platformFeePairEligible({inputMint: WSOL_MINT, outputMint: MSFT}),
      false,
    );
    assert.equal(
      platformFeePairEligible({inputMint: WSOL_MINT, outputMint: STONK}),
      false,
    );
  });
});

describe("quoteWithoutPlatformFee", () => {
  it("removes fee fields from the opaque quote payload", () => {
    const quote = quoteWithoutPlatformFee({
      inputMint: MSFT,
      outputMint: WSOL_MINT,
      inAmount: "1000",
      outAmount: "900",
      otherAmountThreshold: "850",
      priceImpactPct: 0,
      slippageBps: 100,
      platformFee: {amount: "9", feeBps: 100},
      routeLabels: [],
      raw: {platformFeeBps: 100, platformFee: {amount: "9"}, inAmount: "1000"},
    });
    assert.equal(quote.platformFee, null);
    const raw = quote.raw as Record<string, unknown>;
    assert.equal(raw.platformFee, undefined);
    assert.equal(raw.platformFeeBps, undefined);
    assert.equal(raw.inAmount, "1000");
  });
});

describe("feeCollectorFromEnv", () => {
  it("treats placeholder env values as unset", () => {
    const prev = process.env.NEXT_PUBLIC_FEE_WALLET;
    process.env.NEXT_PUBLIC_FEE_WALLET = "unset";
    assert.equal(feeCollectorFromEnv(), null);
    process.env.NEXT_PUBLIC_FEE_WALLET = prev;
  });
});
