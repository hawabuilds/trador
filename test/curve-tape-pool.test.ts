import {strict as assert} from "node:assert";
import {test} from "node:test";

import {bondingCurvePda} from "@nirholas/pump-sdk";
import {PublicKey} from "@solana/web3.js";

/** Reported graduating mint — tape must use the curve PDA, not the mint. */
const GRADUATING_MINT = "FMUruNhQSsiddTRgeiCBWG1vJHZi12MNecG5q2XW8PLK";

test("pump.fun curve tape address is the bonding-curve PDA, not the mint", () => {
  const mint = new PublicKey(GRADUATING_MINT);
  const curve = bondingCurvePda(mint).toBase58();
  assert.notEqual(curve, GRADUATING_MINT);
  assert.match(curve, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});
