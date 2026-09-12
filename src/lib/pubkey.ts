/**
 * One form for every account address we store or look up: exactly as base58
 * spells it.
 *
 * This is the inverse of the rule the EVM version of this app ran on. There,
 * every address was folded to lowercase before it touched the database, because
 * `0xABC…` and `0xabc…` are the same account and a checksummed lookup against a
 * lowercase column returns nothing.
 *
 * On Solana that reasoning does not merely stop applying — it reverses. Base58
 * is case-sensitive, so `So111…` and `so111…` are two different strings and only
 * one of them is an account. Folding case here does not normalise anything; it
 * corrupts. A single `.toLowerCase()` on a mint silently turns a lookup into a
 * miss, or worse, files one mint's price under another mint's key.
 *
 * So there is no normalisation in this module, only validation — and the
 * validation is real. A regex over the base58 alphabet is not enough:
 * `[1-9A-HJ-NP-Za-km-z]{32,44}` happily accepts strings that decode to 31 or 33
 * bytes, which are not account addresses. Every value that reaches storage is
 * decoded and checked for a 32-byte payload.
 *
 * The `Pubkey` brand is the point of the file. It makes "did I validate this?"
 * a question the compiler answers, so adding a new storage path cannot quietly
 * skip the check the way a convention would let it.
 */

/** A string proven to decode to a 32-byte Solana account address. */
export type Pubkey = string & {readonly __pubkey: unique symbol};

export const PUBKEY_BYTES = 32;

/**
 * 32 zero bytes — the System Program id, and what Anchor writes for
 * `Pubkey::default()`. pump.fun uses it as the "quoted in SOL" sentinel, so a
 * value equal to this means *absent*, never "an account called all-ones".
 */
export const DEFAULT_PUBKEY = "11111111111111111111111111111111" as Pubkey;

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const INDEX: ReadonlyMap<string, number> = new Map(
  [...ALPHABET].map((character, position) => [character, position]),
);

/**
 * Decode base58, or null if the string is not base58 at all.
 *
 * Inlined rather than taken from `bs58` because this module sits under nearly
 * every read and write in the app, and a 25-line decoder with no dependency is
 * worth more here than a shared one.
 */
export function decodeBase58(value: string): Uint8Array | null {
  if (value.length === 0) return null;

  const bytes: number[] = [];

  for (const character of value) {
    const digit = INDEX.get(character);
    if (digit === undefined) return null;

    let carry = digit;
    for (let i = 0; i < bytes.length; i += 1) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading '1's encode leading zero bytes, which the loop above cannot
  // produce because they contribute nothing to the accumulated value.
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) bytes.push(0);

  return new Uint8Array(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const next = digits[i] * 256 + carry;
      digits[i] = next % 58;
      carry = (next / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;

  return (
    "1".repeat(leadingZeros) +
    digits
      .reverse()
      .map((digit) => ALPHABET[digit])
      .join("")
  );
}

/** Does this decode to a 32-byte address? */
export function isPubkey(value: unknown): value is Pubkey {
  if (typeof value !== "string") return false;
  // A 32-byte payload is 32–44 base58 characters. Checking first keeps the
  // decoder off obviously-wrong input such as a transaction signature.
  if (value.length < 32 || value.length > 44) return false;
  const bytes = decodeBase58(value);
  return bytes !== null && bytes.length === PUBKEY_BYTES;
}

/**
 * Parse an unknown value — an RPC field, a route param, something a user
 * pasted — into a `Pubkey`, or null.
 *
 * Trims surrounding whitespace, because pasted addresses carry it. Changes
 * nothing else: no case folding, no stripping of inner characters.
 */
export function asPubkey(value: unknown): Pubkey | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isPubkey(trimmed) ? (trimmed as Pubkey) : null;
}

/**
 * Same, but throws. Use this on every path that writes to the database or
 * builds a transaction.
 *
 * It throws rather than returning null on purpose. A bad address that reaches
 * storage is not recoverable by the caller and not visible afterwards — the row
 * simply never matches again. Loud here beats silent there.
 */
export function assertPubkey(value: unknown, label = "pubkey"): Pubkey {
  const parsed = asPubkey(value);
  if (parsed === null) {
    const shown = typeof value === "string" ? JSON.stringify(value) : typeof value;
    throw new Error(`Invalid ${label}: expected a base58 32-byte address, got ${shown}`);
  }
  return parsed;
}

export function asPubkeys(values: Iterable<unknown>): Pubkey[] {
  const out: Pubkey[] = [];
  for (const value of values) {
    const parsed = asPubkey(value);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export function assertPubkeys(values: Iterable<unknown>, label = "pubkey"): Pubkey[] {
  return [...values].map((value) => assertPubkey(value, label));
}

/**
 * Exact comparison.
 *
 * A function rather than `===` so that the comparison has one name to grep for,
 * and so nobody reaches for a case-insensitive compare out of EVM habit.
 */
export function samePubkey(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && a === b;
}

/** Is this the all-zero sentinel rather than a real account? */
export function isDefaultPubkey(value: unknown): boolean {
  return samePubkey(value, DEFAULT_PUBKEY);
}

/**
 * A pubkey for display: `Xso…DF2W`.
 *
 * Never store or compare this. It exists so no component invents its own
 * truncation and lands on a different number of characters per screen.
 */
export function shortPubkey(value: string, lead = 4, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Read a 32-byte address out of an account data buffer at a byte offset. */
export function readPubkeyAt(data: Uint8Array, offset: number): Pubkey | null {
  if (offset < 0 || offset + PUBKEY_BYTES > data.length) return null;
  return encodeBase58(data.subarray(offset, offset + PUBKEY_BYTES)) as Pubkey;
}
