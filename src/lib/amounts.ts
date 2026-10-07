/**
 * Token amounts as exact integers.
 *
 * The ticket used to size a trade with `Math.round(typed * 10 ** decimals)`.
 * That is fine for "$25" and wrong for "all of it": a float round-trip of a
 * balance like 332.652094 can land one base unit above what the wallet holds,
 * and a sell for one unit more than you own fails in simulation with nothing
 * on screen to say why. Everything that is compared against a balance or sent
 * as a trade size goes through these instead.
 */

/**
 * Parse a typed decimal into base units, exactly.
 *
 * Digits past the token's precision are truncated rather than rounded — never
 * round a trade size up past what was typed. Returns null for anything that is
 * not a plain non-negative decimal.
 */
export function toBaseUnits(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole = "", fraction = ""] = trimmed.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt((whole || "0") + padded);
}

/**
 * Lamports from RPC or Postgres.
 *
 * `getBalance` and `bigint` columns often arrive as decimal strings. Passing
 * those through to `Number.isFinite` is false, which made `writeCachedBalances`
 * skip the write while token balances still cached — Stonkfolio then showed
 * holdings but `0.000 SOL` on every Postgres hit after RPC recovered.
 */
export function lamportsFrom(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/** Base units back to a plain decimal string, with no trailing zeros. */
export function fromBaseUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * A percentage of a balance, rounded down.
 *
 * 100 returns the balance itself, untouched — that is the case the rounding
 * problem above actually bites, and the one a "sell all" button exists for.
 */
export function shareOf(raw: bigint, percent: number): bigint {
  if (percent >= 100) return raw;
  if (percent <= 0) return 0n;
  // Basis points keep 25/50/75 exact without floating point.
  return (raw * BigInt(Math.round(percent * 100))) / 10_000n;
}

/**
 * SOL a buy must leave behind.
 *
 * A swap funded in SOL still pays its own network fee and, for a coin the
 * wallet has never held, rent for the new token account (~0.00204 SOL).
 * Spending every lamport produces a transaction that cannot pay for itself.
 */
export const SOL_FEE_RESERVE_LAMPORTS = 10_000_000n; // 0.01 SOL

/** The most SOL a buy may spend from a balance. Never negative. */
export function spendableLamports(balance: bigint): bigint {
  return balance > SOL_FEE_RESERVE_LAMPORTS ? balance - SOL_FEE_RESERVE_LAMPORTS : 0n;
}

/**
 * The multiplier as an exact fraction, so sizing stays in integers.
 *
 * A token's scaled multiplier arrives as a float — 1.005714560286254, or 10
 * after a split. Multiplying base units by a float and rounding is how a sell
 * lands one unit above the balance, which is the failure this file exists to
 * prevent. So it is turned into a numerator over a fixed denominator once, and
 * every conversion after that is bigint division.
 *
 * Twelve places is far more than the extension carries in practice and leaves
 * the numerator well inside what a double represents exactly.
 */
const MULTIPLIER_DEN = 10n ** 12n;

function asFraction(multiplier: number): bigint {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return MULTIPLIER_DEN;
  return BigInt(Math.round(multiplier * 1e12));
}

/**
 * A typed amount, in the units a person sees, as the base units a swap moves.
 *
 * Rounds **down** at every step: digits past the token's precision are
 * truncated, and the division floors. Someone typing their whole balance can
 * therefore come out a base unit short, which fails nothing — the opposite
 * error is a transaction that cannot settle.
 */
export function scaledToBaseUnits(
  text: string,
  decimals: number,
  multiplier = 1,
): bigint | null {
  const typed = toBaseUnits(text, decimals);
  if (typed === null) return null;
  return (typed * MULTIPLIER_DEN) / asFraction(multiplier);
}

/**
 * Base units as the number of tokens somebody actually holds.
 *
 * The inverse of the above, and floored for the same reason: a balance shown a
 * hair low can always be sold, one shown a hair high cannot.
 */
export function baseUnitsToScaled(raw: bigint, decimals: number, multiplier = 1): string {
  return fromBaseUnits((raw * asFraction(multiplier)) / MULTIPLIER_DEN, decimals);
}
