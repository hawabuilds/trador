/**
 * Token-2022's scaled UI amount, which decides what a balance actually is.
 *
 * Some mints carry a multiplier: the number of tokens somebody holds is
 * `raw × multiplier / 10 ** decimals`, not `raw / 10 ** decimals`. Issuers use
 * it for corporate actions — a stock split moves the multiplier instead of
 * reissuing everyone's tokens, and a dividend accrual nudges it up a fraction
 * at a time.
 *
 * This is not theoretical for Trador. Of the 100 stocks in the registry, 15
 * carry a multiplier that is not 1 today: SPYx is 1.0057, MCDx 1.0212 and
 * OPENAI 1.4861. A wallet holding OPENAI was being shown two thirds of what it
 * owns.
 *
 * **Live reads scale, stored history does not.** `getTokenAccountsByOwner` and
 * `getTokenSupply` return a `uiAmount` with the multiplier already applied, so
 * where the RPC gives one it is the answer. A transaction's recorded token
 * balances do not — the ledger stores the plain conversion as of that slot, and
 * the multiplier then is not knowable from the mint now. So a past trade keeps
 * the quantity it was recorded with, and only live balances are scaled.
 */

/** The mint's `scaledUiAmountConfig`, as the RPC parses it. */
export interface ScaledConfig {
  multiplier: number | string;
  newMultiplier?: number | string | null;
  newMultiplierEffectiveTimestamp?: number | string | null;
}

/**
 * The multiplier in force right now.
 *
 * A mint carries the current one and the next, with the moment the next takes
 * over. Reading only `multiplier` gets a split wrong for as long as nobody
 * rewrites the account: NFLXx has carried `multiplier: 1` with a pending 10
 * since the split went through.
 */
export function effectiveMultiplier(
  config: ScaledConfig | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  if (!config) return 1;

  const current = Number(config.multiplier);
  const next = Number(config.newMultiplier);
  const at = Number(config.newMultiplierEffectiveTimestamp);

  const usable = (value: number) => Number.isFinite(value) && value > 0;

  if (usable(next) && Number.isFinite(at) && at <= nowSeconds) return next;
  return usable(current) ? current : 1;
}

/** What `raw` base units are worth in tokens, with the multiplier applied. */
export function scaledUi(
  raw: string | number | bigint,
  decimals: number,
  multiplier = 1,
): number {
  const base = Number(raw);
  if (!Number.isFinite(base) || !Number.isFinite(decimals)) return 0;
  const value = (base / 10 ** decimals) * (Number.isFinite(multiplier) ? multiplier : 1);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The UI amount to trust for a live balance.
 *
 * The RPC's own figure wins, because it is the one the mint's multiplier has
 * already been applied to. Everything else is a fallback for the paths that
 * only kept the raw number.
 */
export function liveUiAmount(
  amount: {uiAmount?: number | null; amount?: string | null; decimals?: number | null},
  multiplier = 1,
): number {
  if (typeof amount.uiAmount === "number" && Number.isFinite(amount.uiAmount)) {
    return amount.uiAmount;
  }
  if (typeof amount.amount !== "string" || typeof amount.decimals !== "number") return 0;
  return scaledUi(amount.amount, amount.decimals, multiplier);
}
