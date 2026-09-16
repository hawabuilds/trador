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
