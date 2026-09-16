import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {test} from "node:test";

import {assertPubkey, encodeBase58} from "@/lib/pubkey";
import {
  importProblem,
  isSolanaSecretKey,
  pickActiveWallet,
  type WalletEntry,
} from "@/lib/wallets";

const CREATED: WalletEntry = {
  address: assertPubkey("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", "created"),
  imported: false,
};
const IMPORTED: WalletEntry = {
  address: assertPubkey("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", "imported"),
  imported: true,
};

test("a stored choice wins while it is still one of the account's wallets", () => {
  assert.equal(pickActiveWallet([CREATED, IMPORTED], IMPORTED.address), IMPORTED);
  assert.equal(pickActiveWallet([IMPORTED, CREATED], CREATED.address), CREATED);
});

test("without a choice, the wallet created at sign-in trades — not list order", () => {
  // Privy listing the imported wallet first must not make it the trading one.
  assert.equal(pickActiveWallet([IMPORTED, CREATED], null), CREATED);
});

test("a stale stored address falls back instead of trading from nothing", () => {
  assert.equal(pickActiveWallet([CREATED], IMPORTED.address), CREATED);
  assert.equal(pickActiveWallet([IMPORTED], "gone"), IMPORTED);
  assert.equal(pickActiveWallet([], CREATED.address), null);
});

// Random bytes in the shape of a keypair. Not a real wallet.
const FAKE_SECRET = encodeBase58(new Uint8Array(randomBytes(64)));

test("a 64-byte base58 keypair is accepted", () => {
  assert.equal(isSolanaSecretKey(FAKE_SECRET), true);
  assert.equal(isSolanaSecretKey(`  ${FAKE_SECRET}\n`), true);
  assert.equal(importProblem(FAKE_SECRET), null);
});

test("an address, a seed phrase, or junk is refused with a plain reason", () => {
  // A wallet address is base58 too, but only 32 bytes.
  assert.equal(isSolanaSecretKey(CREATED.address), false);
  assert.match(importProblem(CREATED.address) ?? "", /not a wallet address/);

  assert.match(
    importProblem("abandon ability able about above absent absorb abstract absurd abuse access accident") ?? "",
    /seed phrase/,
  );
  assert.match(importProblem("   ") ?? "", /Paste a private key/);
  assert.equal(isSolanaSecretKey("0OIl-not-base58"), false);
});

test("a rejection never repeats the pasted text", () => {
  const pasted = `${FAKE_SECRET.slice(0, 40)}x`;
  const message = importProblem(pasted) ?? "";
  assert.ok(message.length > 0);
  assert.equal(message.includes(pasted), false);
});
