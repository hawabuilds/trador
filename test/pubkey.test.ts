import assert from "node:assert/strict";
import {test} from "node:test";

import {
  DEFAULT_PUBKEY,
  asPubkey,
  assertPubkey,
  decodeBase58,
  encodeBase58,
  isDefaultPubkey,
  isPubkey,
  readPubkeyAt,
  samePubkey,
  shortPubkey,
} from "@/lib/pubkey";

/** Real mainnet addresses. Every one of these must survive untouched. */
const REAL = {
  spyx: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  tslax: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  aaplx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  launchlab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pumpAmm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  stonkfunRewards: "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt",
  stonkfunStandard: "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7",
  wsol: "So11111111111111111111111111111111111111112",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

test("every real address validates and is returned verbatim", () => {
  for (const [name, address] of Object.entries(REAL)) {
    assert.equal(isPubkey(address), true, `${name} should be a pubkey`);
    assert.equal(asPubkey(address), address, `${name} must not be rewritten`);
  }
});

test("the all-ones sentinel is a valid pubkey and is recognised as absent", () => {
  assert.equal(isPubkey(DEFAULT_PUBKEY), true);
  assert.equal(isDefaultPubkey(DEFAULT_PUBKEY), true);
  assert.equal(decodeBase58(DEFAULT_PUBKEY)?.every((byte) => byte === 0), true);
  // A real mint must never read as absent.
  assert.equal(isDefaultPubkey(REAL.spyx), false);
});

/**
 * The assertion this whole module exists for.
 *
 * Case folding an address is not normalisation on Solana. Whether or not the
 * folded string happens to still be valid base58 is beside the point — it is a
 * different address, and treating the two as equal is the bug that makes a
 * price show up under the wrong mint.
 */
test("case is meaning, not noise", () => {
  const lowered = REAL.spyx.toLowerCase();
  const uppered = REAL.spyx.toUpperCase();

  assert.notEqual(lowered, REAL.spyx);
  assert.equal(samePubkey(REAL.spyx, lowered), false);
  assert.equal(samePubkey(REAL.spyx, uppered), false);

  // And if the folded form does decode cleanly, it is simply another address —
  // which is exactly why no comparison in this codebase may fold case.
  if (isPubkey(lowered)) {
    assert.notEqual(asPubkey(lowered), asPubkey(REAL.spyx));
  }
});

test("wrong-length payloads are rejected even though they are valid base58", () => {
  // 31 bytes and 33 bytes, both spelled in the base58 alphabet.
  const thirtyOne = encodeBase58(new Uint8Array(31).fill(7));
  const thirtyThree = encodeBase58(new Uint8Array(33).fill(7));

  assert.equal(decodeBase58(thirtyOne)?.length, 31);
  assert.equal(decodeBase58(thirtyThree)?.length, 33);
  assert.equal(isPubkey(thirtyOne), false);
  assert.equal(isPubkey(thirtyThree), false);
});

test("a transaction signature is not an address", () => {
  const signature = encodeBase58(new Uint8Array(64).fill(3));
  assert.equal(isPubkey(signature), false);
});

test("non-base58 and non-string input is rejected", () => {
  const rejected: unknown[] = [
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // an EVM address
    "0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O0O", // 0 and O are not in the alphabet
    "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII", // nor is I
    "llllllllllllllllllllllllllllllll", // nor is l
    "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W ".repeat(2),
    "abc",
    "",
    "   ",
    null,
    undefined,
    123,
    {},
    [],
  ];

  for (const value of rejected) {
    assert.equal(isPubkey(value), false, `${String(value)} should be rejected`);
    assert.equal(asPubkey(value), null, `${String(value)} should not parse`);
  }
});

test("surrounding whitespace is trimmed, because pasted addresses carry it", () => {
  assert.equal(asPubkey(`  ${REAL.usdc}\n`), REAL.usdc);
});

test("assertPubkey throws, and names what it was given", () => {
  assert.throws(() => assertPubkey("nope", "mint"), /Invalid mint/);
  assert.throws(() => assertPubkey(null, "quote mint"), /Invalid quote mint/);
  assert.equal(assertPubkey(REAL.tslax, "mint"), REAL.tslax);
});

test("base58 round-trips, including leading zero bytes", () => {
  const cases: Uint8Array[] = [
    new Uint8Array(32).fill(0),
    new Uint8Array(32).fill(255),
    Uint8Array.from({length: 32}, (_unused, i) => i),
    // Leading zeros are the classic base58 off-by-one: they carry no value and
    // have to be re-emitted as '1' characters.
    Uint8Array.from([0, 0, 0, ...new Array(29).fill(9)]),
  ];

  for (const bytes of cases) {
    const encoded = encodeBase58(bytes);
    assert.deepEqual(decodeBase58(encoded), bytes);
    assert.equal(isPubkey(encoded), true);
  }
});

test("decoding a known address gives known bytes", () => {
  // WSOL is 'So11…112': 32 bytes ending in 1, which makes it a good fixture
  // for catching an endianness or leading-zero mistake.
  const bytes = decodeBase58(REAL.wsol);
  assert.equal(bytes?.length, 32);
  assert.equal(encodeBase58(bytes!), REAL.wsol);
});

test("readPubkeyAt reads an address out of account data at an offset", () => {
  const mint = decodeBase58(REAL.spyx)!;
  const account = new Uint8Array(429);
  account.set(mint, 205); // LaunchpadPool.mintA

  assert.equal(readPubkeyAt(account, 205), REAL.spyx);
  // Off by one must not silently return a plausible-looking address.
  assert.notEqual(readPubkeyAt(account, 204), REAL.spyx);
  // Past the end is null, not a truncated read.
  assert.equal(readPubkeyAt(account, 400), null);
  assert.equal(readPubkeyAt(account, -1), null);
});

test("shortPubkey is display-only and keeps both ends", () => {
  assert.equal(shortPubkey(REAL.spyx), "XsoC…DF2W");
  assert.equal(shortPubkey(REAL.spyx, 2, 2), "Xs…2W");
  assert.equal(shortPubkey("short"), "short");
});
