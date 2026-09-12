/**
 * The floor a pool has to clear before the app calls a coin tradeable.
 *
 * Below this, a market order moves the price more than the trade is worth, so
 * showing a Buy button is a worse outcome than hiding it. The flag it feeds is
 * three-state: under the floor is `false`, over it is `true`, and *unmeasured*
 * is `null`, which still shows. A coin whose liquidity nobody has read yet is
 * not the same as a coin known to be illiquid.
 */
export const MIN_LIQUIDITY_USD = Number(
  process.env.NEXT_PUBLIC_MIN_LIQUIDITY_USD ?? 500,
);
