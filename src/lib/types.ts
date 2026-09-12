import type {LaunchpadId} from "./programs";
import type {Pubkey} from "./pubkey";
import type {PriceAuthority, StockIssuer, StockKind} from "./stocks/registry";
import type {SectorId} from "./sectors";
import type {CoinStatus, QuoteKind} from "./universe";

/**
 * The two things the app shows.
 *
 * Never merged into one type. A stock has a custodian behind it and a stonk
 * does not, and that is the single most important fact on any screen — a shared
 * type would let a component forget which it was holding.
 */
export type AssetKind = "stonk" | "stock";

export type PriceSource = "oracle" | "pool" | "curve" | "snapshot";

/**
 * Where a price came from, and how much to trust it.
 *
 * A discriminated state rather than a nullable number, because "$0.30",
 * "there is no pool yet" and "the provider failed" need different words on
 * screen. Collapsing them to a number renders the last two as $0.
 */
export interface PriceState {
  readonly usd: number | null;
  readonly source: PriceSource | null;
  readonly status: "priced" | "no_pool" | "failed";
  readonly at: string | null;
}

interface AssetBase {
  /** What the row is keyed and routed by. */
  readonly id: string;
  readonly name: string;
  readonly price: PriceState;
  /** 24h change. Null when unknown — never 0 standing in for unknown. */
  readonly changePct: number | null;
  /** Sparkline points, oldest first. Empty when there is no series. */
  readonly series: readonly number[];
}

/** A launchpad coin priced against a stock. */
export interface Stonk extends AssetBase {
  readonly kind: "stonk";
  readonly mint: Pubkey;
  readonly pool: Pubkey;
  readonly symbol: string;
  readonly launchpad: LaunchpadId;
  readonly creator: Pubkey;
  readonly status: CoinStatus;

  readonly quoteMint: Pubkey;
  /** The stock it is priced in — the defining fact about the row. */
  readonly quoteTicker: string;
  readonly quoteKind: QuoteKind;

  /** Does a share of every trade go back to holders, in stock? */
  readonly paysHolders: boolean;
  readonly rewards24hUsd: number | null;

  readonly marketCapUsd: number | null;
  readonly volume24hUsd: number | null;
  /** Three-state. Null on a bonding curve, where there is no pool to measure. */
  readonly liquidityUsd: number | null;
  readonly isTradeable: boolean | null;
  readonly listedAt: string | null;
}

/** A verified tokenized stock. */
export interface Stock extends AssetBase {
  readonly kind: "stock";
  readonly mint: Pubkey;
  readonly ticker: string;
  readonly issuer: StockIssuer;
  readonly stockKind: StockKind;
  readonly priceAuthority: PriceAuthority;
  readonly decimals: number;
  readonly sector: SectorId | null;
  /** How many launches are priced against it — the app's own signal. */
  readonly launchesQuotedAgainst: number;
  readonly marketCapUsd: number | null;
}

export type Asset = Stonk | Stock;

/** Sorts on the Stonks tab. */
export type StonkSort = "trending" | "new" | "marketCap" | "rewards";
/** Sorts on the Stocks tab. */
export type StockSort = "launches" | "marketCap" | "movers";
/** The watchlist's own split. */
export type WatchFilter = "all" | "stonk" | "stock";

export interface FeedPage<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
  /** Where this page came from, so the UI can be honest about staleness. */
  readonly source: "live" | "snapshot";
  readonly capturedAt: string | null;
}

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export interface ChartPoint {
  readonly t: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
}
