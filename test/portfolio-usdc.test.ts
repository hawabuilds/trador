import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {splitMoney} from "@/lib/server/live/holdings";

const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

describe("splitMoney", () => {
  it("takes USDC out of the holdings", () => {
    const {usdcAmount, rest} = splitMoney(
      new Map([
        [SPYX, 1.5],
        [USDC_MINT, 42.25],
      ]),
    );
    assert.equal(usdcAmount, 42.25);
    assert.deepEqual([...rest], [[SPYX, 1.5]]);
  });

  it("leaves a wallet with no USDC alone", () => {
    const {usdcAmount, rest} = splitMoney(new Map([[SPYX, 1.5]]));
    assert.equal(usdcAmount, 0);
    assert.equal(rest.size, 1);
  });

  it("does not claim wrapped SOL as USDC", () => {
    const {usdcAmount, rest} = splitMoney(new Map([[WSOL_MINT, 2]]));
    assert.equal(usdcAmount, 0);
    assert.equal(rest.get(WSOL_MINT), 2);
  });

  it("stops USDC being counted as a token nobody can price", () => {
    // The whole point: before this it fell through to `otherCount`, and the
    // portfolio told you your dollars were "not priced here".
    const {rest} = splitMoney(new Map([[USDC_MINT, 100]]));
    assert.equal(rest.size, 0);
  });
});
