const API_KEY = process.env.JUPITER_API_KEY ?? "";

/**
 * Swap host.
 *
 * Always `api.jup.ag`, which is a change from picking the host off the key.
 * The fee work needs Swap v2, and the keyless `lite-api.jup.ag` serves v1 only
 * — `/swap/v2/quote` answers 404 there — so there is no longer a lite host to
 * fall back to.
 *
 * Keyless requests to `api.jup.ag` are served, but rate limited hard enough
 * that a burst of ten quotes loses five of them. A ticket re-quotes as someone
 * types, so `JUPITER_API_KEY` is effectively required rather than merely
 * recommended.
 */
export const JUPITER_API_BASE =
  process.env.JUPITER_API_URL ?? "https://api.jup.ag";

/**
 * Swap API version.
 *
 * v2, not v1, and the reason is the platform fee rather than anything about
 * routing. On v1 a fee account whose mint is the *input* of the trade is
 * rejected on-chain with Jupiter 6014, which rules out taking a fee in the
 * money leg of a buy. v2 accepts it.
 */
export const JUPITER_SWAP_PATH = "/swap/v2";

export function jupiterFetchHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    accept: "application/json",
    ...(API_KEY ? {"x-api-key": API_KEY} : {}),
    ...extra,
  };
}
