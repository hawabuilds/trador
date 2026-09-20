import {tooSmall} from "@/config/fees";
import {shareOf, toBaseUnits} from "@/lib/amounts";
import type {Pubkey} from "@/lib/pubkey";
import type {Asset, Holding} from "@/lib/types";

export interface WeightSlice {
  readonly id: string;
  readonly mint: Pubkey | null;
  readonly symbol: string;
  readonly valueUsd: number;
  /** Percent of the priced portfolio, 0–100. */
  readonly weight: number;
  readonly asset: Asset;
}

export interface DriftSlice extends WeightSlice {
  readonly target: number;
  /** Actual minus target, in percentage points. */
  readonly deltaPct: number;
  /** Dollars to buy (positive) or sell (negative) to reach target. */
  readonly deltaUsd: number;
}

export interface RebalanceLeg {
  readonly mint: string;
  readonly asset: Asset;
  readonly side: "sell" | "buy";
  readonly amountUsd: number;
  /** Base units as a decimal string for the router. */
  readonly amountBase: string;
  readonly belowMinimum: boolean;
}

export interface RebalancePlan {
  readonly sells: readonly RebalanceLeg[];
  readonly buys: readonly RebalanceLeg[];
}

const TARGET_SUM_TOLERANCE = 0.1;

/** Holdings with a known, positive USD value — the only ones that belong in a pie. */
export function pricedHoldings(holdings: readonly Holding[]): Holding[] {
  return holdings.filter(
    (holding) => holding.valueUsd !== null && holding.valueUsd > 0,
  );
}

export function assetSymbol(asset: Asset): string {
  return asset.kind === "stock" ? asset.ticker : asset.symbol;
}

export function assetDecimals(asset: Asset): number {
  if (asset.kind === "stock") return asset.decimals;
  return asset.decimals ?? 6;
}

/** Actual allocation weights from priced holdings. */
export function actualWeights(holdings: readonly Holding[]): WeightSlice[] {
  const priced = pricedHoldings(holdings);
  const total = priced.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0);
  if (total <= 0) return [];

  return priced.map((holding) => ({
    id: holding.asset.mint,
    mint: holding.asset.mint,
    symbol: assetSymbol(holding.asset),
    valueUsd: holding.valueUsd ?? 0,
    weight: ((holding.valueUsd ?? 0) / total) * 100,
    asset: holding.asset,
  }));
}

/**
 * Scale target weights so they sum to 100 across the given mints.
 * Unknown mints are dropped; missing mints default to zero before scaling.
 */
export function normalizeTargets(
  targets: Record<string, number>,
  mints: readonly Pubkey[],
): Record<string, number> {
  const picked: Record<string, number> = {};
  let sum = 0;
  for (const mint of mints) {
    const value = Number(targets[mint]);
    const weight = Number.isFinite(value) && value >= 0 ? value : 0;
    picked[mint] = weight;
    sum += weight;
  }
  if (sum <= 0) {
    const even = mints.length > 0 ? 100 / mints.length : 0;
    return Object.fromEntries(mints.map((mint) => [mint, even]));
  }
  if (Math.abs(sum - 100) <= TARGET_SUM_TOLERANCE) return picked;
  const scale = 100 / sum;
  return Object.fromEntries(
    mints.map((mint) => [mint, picked[mint] * scale]),
  );
}

export function targetsValid(targets: Record<string, number>): boolean {
  const sum = Object.values(targets).reduce((total, value) => total + value, 0);
  return Math.abs(sum - 100) <= TARGET_SUM_TOLERANCE;
}

/** Compare actual weights to targets for every priced holding. */
export function drift(
  holdings: readonly Holding[],
  targets: Record<string, number>,
): DriftSlice[] {
  const slices = actualWeights(holdings);
  const total = slices.reduce((sum, slice) => sum + slice.valueUsd, 0);

  return slices.map((slice) => {
    const target = slice.mint ? (targets[slice.mint] ?? 0) : 0;
    const deltaPct = slice.weight - target;
    const targetUsd = (target / 100) * total;
    const deltaUsd = targetUsd - slice.valueUsd;
    return {...slice, target, deltaPct, deltaUsd};
  });
}

/** Largest absolute deviation from target, in percentage points. */
export function rebalanceScore(rows: readonly DriftSlice[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((row) => Math.abs(row.deltaPct)));
}

function legFromDelta(
  holding: Holding,
  side: "sell" | "buy",
  amountUsd: number,
): RebalanceLeg | null {
  const price = holding.asset.price.usd;
  if (price === null || price <= 0) return null;

  const decimals = assetDecimals(holding.asset);
  const belowMinimum = tooSmall(amountUsd);

  let amountBase: bigint | null;
  if (side === "sell") {
    const cappedUsd = Math.min(amountUsd, holding.valueUsd ?? 0);
    const sharePct =
      holding.valueUsd && holding.valueUsd > 0
        ? (cappedUsd / holding.valueUsd) * 100
        : 100;
    const heldBase =
      toBaseUnits(holding.amount.toString(), decimals) ?? 0n;
    amountBase = shareOf(heldBase, Math.min(sharePct, 100));
    if (amountBase <= 0n) return null;
  } else {
    const tokens = amountUsd / price;
    amountBase = toBaseUnits(tokens.toFixed(decimals), decimals);
    if (amountBase === null || amountBase <= 0n) return null;
  }

  return {
    mint: holding.asset.mint,
    asset: holding.asset,
    side,
    amountUsd,
    amountBase: amountBase.toString(),
    belowMinimum,
  };
}

/** Sell overweight holdings to the hub, then buy underweight ones from it. */
export function planRebalance(holdings: readonly Holding[]): RebalancePlan {
  return planRebalanceWithTargets(holdings, {});
}

export function planRebalanceWithTargets(
  holdings: readonly Holding[],
  targets: Record<string, number>,
): RebalancePlan {
  const priced = pricedHoldings(holdings);
  const byMint = new Map(priced.map((holding) => [holding.asset.mint, holding]));
  const rows = drift(holdings, targets);

  const sells: RebalanceLeg[] = [];
  const buys: RebalanceLeg[] = [];

  for (const row of rows) {
    if (!row.mint) continue;
    const holding = byMint.get(row.mint);
    if (!holding) continue;

    if (row.deltaUsd < 0) {
      const leg = legFromDelta(holding, "sell", Math.abs(row.deltaUsd));
      if (leg) sells.push(leg);
    } else if (row.deltaUsd > 0) {
      const leg = legFromDelta(holding, "buy", row.deltaUsd);
      if (leg) buys.push(leg);
    }
  }

  sells.sort((a, b) => b.amountUsd - a.amountUsd);
  buys.sort((a, b) => b.amountUsd - a.amountUsd);

  return {sells, buys};
}

/**
 * Distribute fresh cash across underweight slices, proportional to their deficit.
 * Nothing is sold.
 */
export function planTopUp(
  holdings: readonly Holding[],
  targets: Record<string, number>,
  amountUsd: number,
): RebalanceLeg[] {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return [];

  const rows = drift(holdings, targets).filter((row) => row.deltaUsd > 0);
  const deficit = rows.reduce((sum, row) => sum + row.deltaUsd, 0);
  if (deficit <= 0) return [];

  const byMint = new Map(
    pricedHoldings(holdings).map((holding) => [holding.asset.mint, holding]),
  );

  const legs: RebalanceLeg[] = [];
  for (const row of rows) {
    if (!row.mint) continue;
    const holding = byMint.get(row.mint);
    if (!holding) continue;
    const sliceUsd = (row.deltaUsd / deficit) * amountUsd;
    const leg = legFromDelta(holding, "buy", sliceUsd);
    if (leg) legs.push(leg);
  }

  return legs.sort((a, b) => b.amountUsd - a.amountUsd);
}

/** Group tiny slices for the pie chart legend. */
export function groupSmallSlices(
  slices: readonly WeightSlice[],
  minWeight = 2,
): Array<WeightSlice & {grouped?: WeightSlice[]}> {
  const large: Array<WeightSlice & {grouped?: WeightSlice[]}> = [];
  const small: WeightSlice[] = [];

  for (const slice of slices) {
    if (slice.weight >= minWeight) large.push(slice);
    else small.push(slice);
  }

  if (small.length === 0) return large;
  if (small.length === 1 && large.length === 0) return small;

  const otherValue = small.reduce((sum, slice) => sum + slice.valueUsd, 0);
  const otherWeight = small.reduce((sum, slice) => sum + slice.weight, 0);
  return [
    ...large,
    {
      id: "__other__",
      mint: null,
      symbol: "Other",
      valueUsd: otherValue,
      weight: otherWeight,
      asset: small[0].asset,
      grouped: small,
    },
  ];
}

/** Seed targets from current weights, rounded to one decimal. */
export function targetsFromActual(holdings: readonly Holding[]): Record<string, number> {
  const slices = actualWeights(holdings);
  const rounded = slices
    .filter((slice): slice is WeightSlice & {mint: Pubkey} => slice.mint !== null)
    .map((slice) => ({
      mint: slice.mint,
      weight: Math.round(slice.weight * 10) / 10,
    }));
  const sum = rounded.reduce((total, row) => total + row.weight, 0);
  const adjust = rounded.length > 0 ? (100 - sum) / rounded.length : 0;
  return Object.fromEntries(
    rounded.map((row) => [row.mint, row.weight + adjust]),
  );
}

export function equalTargets(mints: readonly Pubkey[]): Record<string, number> {
  if (mints.length === 0) return {};
  const each = Math.round((100 / mints.length) * 10) / 10;
  const result: Record<string, number> = {};
  for (const mint of mints) result[mint] = each;
  const sum = mints.length * each;
  if (Math.abs(sum - 100) > TARGET_SUM_TOLERANCE) {
    result[mints[0]] += 100 - sum;
  }
  return result;
}
