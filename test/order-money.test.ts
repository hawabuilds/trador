import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
  MIN_FEE_LAMPORTS,
  SOL,
  USDC,
  moneyReceived,
  overBalanceMessage,
  shortOfNetworkFees,
  spendableBalance,
} from "@/lib/orderMoney";
import {SOL_FEE_RESERVE_LAMPORTS} from "@/lib/amounts";

/** Enough SOL that the reserve is not what the test is about. */
const PLENTY_OF_SOL = 2_000_000_000n;
const TEN_USDC = 10_000_000n;

describe("spendableBalance on a buy", () => {
  it("spends USDC to the last unit", () => {
    assert.equal(
      spendableBalance({
        buying: true,
        settleMint: "usdc",
        lamports: PLENTY_OF_SOL,
        usdc: TEN_USDC,
        held: 0n,
      }),
      TEN_USDC,
    );
  });

  it("keeps SOL back for fees, because the same balance pays for the trade", () => {
    const spendable = spendableBalance({
      buying: true,
      settleMint: "sol",
      lamports: PLENTY_OF_SOL,
      usdc: TEN_USDC,
      held: 0n,
    });
    assert.equal(spendable, PLENTY_OF_SOL - SOL_FEE_RESERVE_LAMPORTS);
  });

  it("has nothing to spend when the wallet holds no USDC", () => {
    assert.equal(
      spendableBalance({
        buying: true,
        settleMint: "usdc",
        lamports: PLENTY_OF_SOL,
        usdc: 0n,
        held: 0n,
      }),
      0n,
    );
  });

  it("knows the difference between no USDC and an unread balance", () => {
    assert.equal(
      spendableBalance({
        buying: true,
        settleMint: "usdc",
        lamports: PLENTY_OF_SOL,
        usdc: null,
        held: 0n,
      }),
      null,
    );
  });
});

describe("spendableBalance on a sell", () => {
  it("is the position, whichever money the payout is in", () => {
    for (const settleMint of ["sol", "usdc"] as const) {
      assert.equal(
        spendableBalance({
          buying: false,
          settleMint,
          lamports: PLENTY_OF_SOL,
          usdc: TEN_USDC,
          held: 4_200n,
        }),
        4_200n,
      );
    }
  });
});

describe("shortOfNetworkFees", () => {
  it("catches a USDC buy from a wallet with no SOL to sign it", () => {
    assert.equal(
      shortOfNetworkFees({buying: true, settleMint: "usdc", lamports: 0n}),
      true,
    );
    assert.equal(
      shortOfNetworkFees({
        buying: true,
        settleMint: "usdc",
        lamports: MIN_FEE_LAMPORTS - 1n,
      }),
      true,
    );
    assert.equal(
      shortOfNetworkFees({buying: true, settleMint: "usdc", lamports: MIN_FEE_LAMPORTS}),
      false,
    );
  });

  it("leaves a SOL buy to the reserve instead", () => {
    assert.equal(
      shortOfNetworkFees({buying: true, settleMint: "sol", lamports: 0n}),
      false,
    );
  });

  it("catches a sell from a wallet with no SOL, in either payout", () => {
    for (const settleMint of ["sol", "usdc"] as const) {
      assert.equal(shortOfNetworkFees({buying: false, settleMint, lamports: 0n}), true);
    }
  });

  it("says nothing while the balance is still being read", () => {
    assert.equal(
      shortOfNetworkFees({buying: true, settleMint: "usdc", lamports: null}),
      false,
    );
  });
});

describe("moneyReceived", () => {
  it("reads a USDC payout in USDC, not in lamports", () => {
    // 25 USDC. Read with SOL's nine decimals this would show 0.000000025.
    assert.equal(moneyReceived("25000000", USDC), 25);
    assert.equal(moneyReceived("25000000", SOL), 0.025);
  });

  it("reads a SOL payout in SOL", () => {
    assert.equal(moneyReceived("150000000", SOL), 0.15);
  });
});

describe("overBalanceMessage", () => {
  const format = (value: number) => String(value);

  it("names the money the buy is funded in", () => {
    assert.equal(
      overBalanceMessage({
        buying: true,
        available: 10,
        symbol: "USDC",
        reserved: false,
        format,
      }),
      "You can spend up to 10 USDC.",
    );
  });

  it("mentions the reserve only when there is one", () => {
    assert.match(
      overBalanceMessage({
        buying: true,
        available: 1,
        symbol: "SOL",
        reserved: true,
        format,
      }),
      /kept back for network fees/,
    );
  });

  it("says plainly when the wallet holds none of it", () => {
    assert.equal(
      overBalanceMessage({
        buying: true,
        available: 0,
        symbol: "USDC",
        reserved: false,
        format,
      }),
      "You don't hold any USDC in this wallet.",
    );
  });
});
