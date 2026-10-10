import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {feeBpsFromEnv} from "@/config/fees";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {
  feeAccountAddress,
  feeFromParts,
  feeLegFor,
  feeWalletFromEnv,
} from "@/lib/server/live/platformFee";
import {quoteWithoutPlatformFee} from "@/lib/server/live/jupiter";
import {assertPubkey} from "@/lib/pubkey";

const SPYX = assertPubkey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "SPYx");
const STONK = assertPubkey(
  "FjTfaSH861nVcbAxdFAHTvhoSL4kyR6wgTWynuJkapht",
  "stonk",
);
/** A Squads vault: a program address, so off the ed25519 curve. */
const VAULT = assertPubkey(
  "S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS",
  "vault",
);

function withEnv(name: string, value: string | undefined, run: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("feeLegFor", () => {
  it("takes a sell's fee out of the money it pays out", () => {
    assert.deepEqual(feeLegFor({inputMint: SPYX, outputMint: USDC_MINT}), {
      mint: USDC_MINT,
      side: "output",
    });
    assert.deepEqual(feeLegFor({inputMint: SPYX, outputMint: WSOL_MINT}), {
      mint: WSOL_MINT,
      side: "output",
    });
  });

  it("takes a buy's fee out of the money it spends", () => {
    assert.deepEqual(feeLegFor({inputMint: USDC_MINT, outputMint: SPYX}), {
      mint: USDC_MINT,
      side: "input",
    });
    assert.deepEqual(feeLegFor({inputMint: WSOL_MINT, outputMint: SPYX}), {
      mint: WSOL_MINT,
      side: "input",
    });
  });

  it("never takes a fee in the thing being traded", () => {
    assert.equal(feeLegFor({inputMint: SPYX, outputMint: STONK}), null);
    assert.equal(feeLegFor({inputMint: STONK, outputMint: SPYX}), null);
  });
});

describe("feeFromParts", () => {
  const leg = {mint: USDC_MINT, side: "output"} as const;

  it("charges when the rate, the wallet and the account are all there", () => {
    const fee = feeFromParts({bps: 50, wallet: VAULT, leg, accountMint: USDC_MINT});
    assert.equal(fee?.bps, 50);
    assert.equal(fee?.mint, USDC_MINT);
    assert.equal(fee?.side, "output");
    assert.equal(fee?.account, feeAccountAddress(VAULT, USDC_MINT));
  });

  it("charges nothing when the rate is off", () => {
    assert.equal(feeFromParts({bps: 0, wallet: VAULT, leg, accountMint: USDC_MINT}), null);
  });

  it("charges nothing when the wallet is unset", () => {
    assert.equal(feeFromParts({bps: 50, wallet: null, leg, accountMint: USDC_MINT}), null);
  });

  it("charges nothing when neither side of the trade is money", () => {
    assert.equal(
      feeFromParts({bps: 50, wallet: VAULT, leg: null, accountMint: USDC_MINT}),
      null,
    );
  });

  it("charges nothing when the vault's token account does not exist yet", () => {
    assert.equal(feeFromParts({bps: 50, wallet: VAULT, leg, accountMint: null}), null);
  });

  it("charges nothing when the account holds the wrong mint", () => {
    assert.equal(
      feeFromParts({bps: 50, wallet: VAULT, leg, accountMint: WSOL_MINT}),
      null,
    );
  });
});

describe("feeAccountAddress", () => {
  it("derives an account for an off-curve owner", () => {
    // A Squads vault is a program address. Deriving with the on-curve check
    // left on throws, which would take the whole quote down with it.
    assert.doesNotThrow(() => feeAccountAddress(VAULT, USDC_MINT));
    assert.notEqual(
      feeAccountAddress(VAULT, USDC_MINT),
      feeAccountAddress(VAULT, WSOL_MINT),
    );
  });
});

describe("feeWalletFromEnv", () => {
  it("reads a wallet", () => {
    withEnv("TRADOR_FEE_WALLET", VAULT, () => {
      assert.equal(feeWalletFromEnv(), VAULT);
    });
  });

  it("treats unset, placeholder and invalid values as no wallet", () => {
    for (const value of [undefined, "", "  ", "unset", "TBD", "not-a-pubkey", "0"]) {
      withEnv("TRADOR_FEE_WALLET", value, () => {
        assert.equal(feeWalletFromEnv(), null, `expected no wallet for ${String(value)}`);
      });
    }
  });
});

describe("feeBpsFromEnv", () => {
  it("is off unless the rate says otherwise", () => {
    for (const value of [undefined, "", "0", "-50", "nonsense"]) {
      withEnv("NEXT_PUBLIC_TRADOR_FEE_BPS", value, () => {
        assert.equal(feeBpsFromEnv(), 0, `expected 0 for ${String(value)}`);
      });
    }
  });

  it("reads a rate and refuses an absurd one", () => {
    withEnv("NEXT_PUBLIC_TRADOR_FEE_BPS", "50", () => {
      assert.equal(feeBpsFromEnv(), 50);
    });
    withEnv("NEXT_PUBLIC_TRADOR_FEE_BPS", "9000", () => {
      assert.equal(feeBpsFromEnv(), 500);
    });
  });
});

describe("quoteWithoutPlatformFee", () => {
  it("removes fee fields from the opaque quote payload", () => {
    const quote = quoteWithoutPlatformFee({
      inputMint: SPYX,
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
