import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {PublicKey} from "@solana/web3.js";

import {feeBpsFromEnv} from "@/config/fees";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {
  feeAccountAddress,
  feeAmountFor,
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
/**
 * A Squads-shaped vault: a program address, so off the ed25519 curve.
 *
 * Derived rather than picked, because an ordinary wallet address is on the
 * curve and would let the off-curve test pass against code that cannot in fact
 * handle a vault.
 */
const VAULT = assertPubkey(
  "66msETUaW5rszZ43wHJquYFmSqQ9JErz8uB8rjfMubtC",
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
    assert.equal(
      PublicKey.isOnCurve(new PublicKey(VAULT)),
      false,
      "the fixture must be off-curve or this proves nothing",
    );
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

describe("feeAmountFor", () => {
  /*
   * The numbers come from simulating each leg against mainnet — built, never
   * sent — and reading what the collection account actually gained. They are
   * here so a change to the arithmetic has to disagree with the chain out loud.
   */
  it("charges a buy out of what is spent", () => {
    // $25 of USDC in, 50 bps: the vault gained exactly 125,000 USDC units.
    assert.equal(
      feeAmountFor({
        fee: {side: "input", bps: 50},
        inAmount: "25000000",
        quotedFeeAmount: "16076",
      }),
      "125000",
    );
    // 0.15 SOL in, 50 bps: the vault gained exactly 750,000 lamports.
    assert.equal(
      feeAmountFor({
        fee: {side: "input", bps: 50},
        inAmount: "150000000",
        quotedFeeAmount: "10402",
      }),
      "750000",
    );
  });

  it("ignores the router's figure on a buy, which names the wrong token", () => {
    // The quote said 16,076 — of the stock being bought, not of the USDC paid.
    assert.notEqual(
      feeAmountFor({
        fee: {side: "input", bps: 50},
        inAmount: "25000000",
        quotedFeeAmount: "16076",
      }),
      "16076",
    );
  });

  it("takes a sell's fee from the router, which is already in the right mint", () => {
    assert.equal(
      feeAmountFor({
        fee: {side: "output", bps: 50},
        inAmount: "2000000",
        quotedFeeAmount: "77741",
      }),
      "77741",
    );
    assert.equal(
      feeAmountFor({
        fee: {side: "output", bps: 50},
        inAmount: "2000000",
        quotedFeeAmount: "721088",
      }),
      "721088",
    );
  });

  it("rounds a buy down, never up", () => {
    // 1 unit short of a clean 0.5%: the extra base unit stays with the trader.
    assert.equal(
      feeAmountFor({fee: {side: "input", bps: 50}, inAmount: "199", quotedFeeAmount: null}),
      "0",
    );
    assert.equal(
      feeAmountFor({fee: {side: "input", bps: 50}, inAmount: "100199", quotedFeeAmount: null}),
      "500",
    );
  });

  it("reports nothing rather than a guess when the amount is unusable", () => {
    assert.equal(
      feeAmountFor({fee: {side: "input", bps: 50}, inAmount: "", quotedFeeAmount: "1"}),
      null,
    );
    assert.equal(
      feeAmountFor({fee: {side: "output", bps: 50}, inAmount: "1000", quotedFeeAmount: null}),
      null,
    );
  });
});
