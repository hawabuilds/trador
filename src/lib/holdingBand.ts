/**
 * What a comment says about its author's stake, in bands rather than figures.
 *
 * A comment is a call, and what matters is whether the person saying it has
 * money on the line — not how much. Bands answer the first question and refuse
 * the second: the exact size of someone's position is theirs, and it only
 * appears on their own profile when they have turned Public portfolio on.
 *
 * Rounded down, always. Someone holding $249 is in the $50+ band, never the
 * $250+ one, so the badge can never overstate what is behind a call.
 */

export type HoldingBand = "10" | "50" | "250" | "1k";

/** Floors, high to low. $10 is the minimum holding that can comment at all. */
const BANDS: readonly {band: HoldingBand; floor: number}[] = [
  {band: "1k", floor: 1_000},
  {band: "250", floor: 250},
  {band: "50", floor: 50},
  {band: "10", floor: 10},
];

export const BAND_LABEL: Record<HoldingBand, string> = {
  "10": "$10+",
  "50": "$50+",
  "250": "$250+",
  "1k": "$1K+",
};

/** The band a current holding falls in, or null when it is under the floor. */
export function bandFor(usd: number | null | undefined): HoldingBand | null {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return null;
  return BANDS.find((entry) => usd >= entry.floor)?.band ?? null;
}

/**
 * Did this person buy before the coin first tripled?
 *
 * Measured against the earliest price we hold for the coin, which is the first
 * fill anyone's wallet recorded here — not the launch price, which we often
 * never saw. It can only ever be late, never early: a coin we started watching
 * after its run has a high "earliest" price, so the badge is withheld rather
 * than handed out wrongly.
 */
export function boughtEarly(input: {
  firstBuyPriceUsd: number | null;
  earliestPriceUsd: number | null;
}): boolean {
  const {firstBuyPriceUsd, earliestPriceUsd} = input;
  if (!firstBuyPriceUsd || !earliestPriceUsd) return false;
  if (!(firstBuyPriceUsd > 0) || !(earliestPriceUsd > 0)) return false;
  return firstBuyPriceUsd < earliestPriceUsd * 3;
}
