/**
 * Whether a coin belongs in Trador.
 *
 * The chain decides what exists. Supabase stores it. Providers only decorate
 * it. Nothing else re-implements this test — the feed, search, the Stonkfolio
 * and the indexer all import from here, because the predecessor app's one
 * duplicated copy of a membership rule is what let its feed and its search
 * disagree about which coins were real.
 *
 * A coin qualifies if it was launched by a program Trador recognises AND either:
 *
 *   1. it is priced against a verified tokenized stock, or
 *   2. it is priced against SOL or a stablecoin but routes a share of every
 *      trade back to holders in a stock.
 *
 * Arm 2 exists because the interesting thing about StonkFun's reward launches
 * is not what the coin is quoted in, it is where the fees go. A coin quoted in
 * SOL that pays its holders in NVDAx is doing the thing this app is about.
 *
 * Two states:
 *   pending — on the bonding curve. Stored, not shown.
 *   listed  — graduated into a real pool. Shown.
 */

import type {LaunchpadId} from "./programs";
import {USDC_MINT, WSOL_MINT} from "./programs";
import {isStockMint} from "./stocks/registry";

export type {LaunchpadId};

/**
 * What a coin is priced in.
 *
 * `stock` — a verified tokenized equity, ETF, commodity or pre-IPO name.
 * `sol`   — SOL or wrapped SOL.
 * `stable`— USDC and friends.
 * `other` — a real quote asset Trador does not classify: another launchpad
 *           coin, a crypto major, or a stock-shaped mint whose issuer has not
 *           been verified. Explicitly not "unknown" — it is known, and known
 *           not to count.
 */
export type QuoteKind = "stock" | "sol" | "stable" | "other";

export type CoinStatus = "pending" | "listed";

export interface UniverseInput {
  readonly launchpad: LaunchpadId | null;
  readonly quoteKind: QuoteKind | null;
  /** Does the launch route holder rewards, and in what? */
  readonly rewardStock: string | null;
  readonly graduated: boolean;
}

/**
 * Classify a quote mint.
 *
 * An unverified stock-shaped mint lands in `other` and the coin fails arm 1.
 * That under-includes — a coin that ought to be in the feed is missing, and
 * someone notices and the registry gets fixed. Guessing the other way
 * mis-attributes, which nobody can see. Under-inclusion is the safe direction.
 */
export function quoteKindFor(quoteMint: string): QuoteKind {
  if (isStockMint(quoteMint)) return "stock";
  if (quoteMint === WSOL_MINT) return "sol";
  if (quoteMint === USDC_MINT) return "stable";
  return "other";
}

export function statusFor(input: Pick<UniverseInput, "graduated">): CoinStatus {
  return input.graduated ? "listed" : "pending";
}

/** Arm 1: a recognised launch priced against a verified stock. */
export function isStockPaired(
  input: Pick<UniverseInput, "launchpad" | "quoteKind">,
): boolean {
  return input.launchpad !== null && input.quoteKind === "stock";
}

/** Arm 2: priced in SOL or a stablecoin, but pays holders in a stock. */
export function paysHoldersInStock(
  input: Pick<UniverseInput, "launchpad" | "quoteKind" | "rewardStock">,
): boolean {
  if (input.launchpad === null) return false;
  if (input.quoteKind !== "sol" && input.quoteKind !== "stable") return false;
  return Boolean(input.rewardStock);
}

export function qualifiesForUniverse(input: UniverseInput): boolean {
  if (input.launchpad === null) return false;
  return isStockPaired(input) || paysHoldersInStock(input);
}

/** What the feeds and search are allowed to show. */
export function isListed(input: UniverseInput): boolean {
  return statusFor(input) === "listed" && qualifiesForUniverse(input);
}

/**
 * Why a coin was excluded, for the search page and the indexer's logs.
 *
 * The predecessor app returned a bare boolean here and every "why isn't my
 * coin showing up?" needed a database session to answer. A reason string costs
 * nothing and answers it from the UI.
 */
export type ExclusionReason =
  | "not-a-recognised-launchpad"
  | "quote-asset-not-a-verified-stock"
  | "no-holder-rewards-in-stock"
  | "still-on-curve";

export function exclusionReason(input: UniverseInput): ExclusionReason | null {
  if (input.launchpad === null) return "not-a-recognised-launchpad";

  if (!qualifiesForUniverse(input)) {
    // Distinguish the two ways arm 2 can fail, since they point at different
    // fixes: an unrecognised quote asset may just need registry verification,
    // whereas no rewards means the coin genuinely is not in scope.
    return input.quoteKind === "sol" || input.quoteKind === "stable"
      ? "no-holder-rewards-in-stock"
      : "quote-asset-not-a-verified-stock";
  }

  if (statusFor(input) === "pending") return "still-on-curve";
  return null;
}
