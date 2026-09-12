/**
 * The platform fee, in basis points.
 *
 * Flat 50 bps, taken by the router into a token account Trador owns for the
 * output mint. No floor and no tiering: a fee schedule people have to reason
 * about is a fee schedule they assume is worse than it is.
 *
 * The dust guard exists because a fee on a trade small enough that the fee is
 * most of it is not worth taking.
 */
export const FEE_BPS = Number(process.env.NEXT_PUBLIC_FEE_BPS ?? 50);

export const DUST_USD = 1;

export function feeFor(amountUsd: number): {usd: number; pct: number} {
  const usd = (amountUsd * FEE_BPS) / 10_000;
  return {usd, pct: FEE_BPS / 100};
}

export function tooSmall(amountUsd: number): boolean {
  return !Number.isFinite(amountUsd) || amountUsd < DUST_USD;
}
