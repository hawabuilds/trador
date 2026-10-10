/**
 * The platform fee, in basis points.
 *
 * Off by default. `NEXT_PUBLIC_TRADOR_FEE_BPS` turns it on, and nothing is
 * charged until it does — an unset or unparseable value is zero, never a
 * guess. The rate is public because the ticket prints it; the wallet it is
 * paid into is not, and lives server-side in `TRADOR_FEE_WALLET`.
 *
 * Flat, with no floor and no tiering: a fee schedule people have to reason
 * about is a fee schedule they assume is worse than it is.
 */

/** Well above anything intended, low enough that a typo cannot rob anyone. */
const MAX_FEE_BPS = 500;

export function feeBpsFromEnv(): number {
  const parsed = Number(process.env.NEXT_PUBLIC_TRADOR_FEE_BPS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.floor(parsed), MAX_FEE_BPS);
}

export const FEE_BPS = feeBpsFromEnv();

export const DUST_USD = 1;

/**
 * The fee in dollars, estimated from the trade's dollar value.
 *
 * An estimate, and only safe where the exact figure is not yet known. The
 * authority on what is actually charged is the server, which works it out from
 * the leg the fee comes out of.
 */
export function feeFor(amountUsd: number): {usd: number; pct: number} {
  const usd = (amountUsd * FEE_BPS) / 10_000;
  return {usd, pct: FEE_BPS / 100};
}

export function tooSmall(amountUsd: number): boolean {
  return !Number.isFinite(amountUsd) || amountUsd < DUST_USD;
}
