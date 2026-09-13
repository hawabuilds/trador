import type {LaunchpadId} from "./programs";
import type {Pubkey} from "./pubkey";
import type {SectorId} from "./sectors";
import type {PriceAuthority, StockIssuer, StockKind} from "./stocks/registry";
import type {CoinStatus, QuoteKind} from "./universe";

/**
 * The two things the app shows.
 *
 * Never merged into one type. A stock has a custodian behind it and a stonk
 * does not, and that is the single most important fact on any screen — a shared
 * type would let a component forget which it was holding.
 */
export type AssetKind = "stonk" | "stock";

export interface SocialLinks {
  x: string | null;
  telegram: string | null;
  website: string | null;
  discord: string | null;
}

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
  /** Creator artwork, already resolved to a fetchable URL. */
  readonly imageUrl: string | null;
  readonly decimals: number | null;
  readonly circulatingSupply: number | null;
  readonly socials: SocialLinks | null;
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
  /** The *company's* market cap, when a provider carries it. Never the token's. */
  readonly marketCapUsd: number | null;
  readonly description: string | null;
}

export type Asset = Stonk | Stock;

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export interface ChartPoint {
  /** Epoch milliseconds. */
  t: number;
  price: number;
  /** Real OHLC when the provider sent it. Missing means close-only. */
  open?: number;
  high?: number;
  low?: number;
}

export type ChartStyle = "line" | "candles";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/**
 * A tokenized stock tracks an equity that only trades in session hours, so the
 * fine buckets are mostly empty. Its chart offers only windows the underlying
 * tape can actually fill.
 */
export const STOCK_TIMEFRAMES = ["5m", "1h", "1D"] as const;
export type StockTimeframe = (typeof STOCK_TIMEFRAMES)[number];

/** Active pill / header: show the bucket that was actually drawn. */
export function timeframeLabel(
  requested: Timeframe,
  resolved?: Timeframe | null,
): string {
  if (resolved && resolved !== requested) return `${requested} · ${resolved}`;
  return requested;
}

/** Windows for the Stonkfolio equity chart — total wallet value over time. */
export const PORTFOLIO_RANGES = ["1H", "1D", "1W", "1M", "1Y", "ALL"] as const;
export type PortfolioRange = (typeof PORTFOLIO_RANGES)[number];

// ---------------------------------------------------------------------------
// The tape
// ---------------------------------------------------------------------------

export interface Trade {
  id: string;
  side: "buy" | "sell";
  /** Base units of the asset moved. */
  amount: number;
  amountUsd: number;
  priceUsd: number;
  /** Wallet that traded. Rendered short, links to the explorer. */
  maker: string;
  /** The transaction the fill settled in. Shown in the TXN column. */
  txHash: string;
  /** Set when the maker is someone with a profile in the app. */
  makerHandle: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export interface CommentAuthor {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
}

export interface AssetComment {
  id: string;
  assetId: string;
  parentId: string | null;
  author: CommentAuthor;
  body: string;
  createdAt: string;
}

export interface CommentThread {
  root: AssetComment;
  replies: AssetComment[];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Someone with an account.
 *
 * `isFollowing` is three-state on purpose: `true` and `false` are the caller's
 * relationship to this person, and `null` means nobody is signed in. Collapsing
 * null to false would put a Follow button in front of a visitor with no
 * account, which fails at the moment they tap it.
 */
export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  bio: string | null;
  wallet: string | null;
  followers: number;
  following: number;
  isFollowing: boolean | null;
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  /** Real article artwork from the page's OG tags. Null when it has none. */
  imageUrl: string | null;
}

export const NEWS_WINDOWS = ["latest", "24h", "7d", "30d", "all"] as const;
export type NewsWindow = (typeof NEWS_WINDOWS)[number];

export const NEWS_TOPICS = ["all", "stocks", "solana", "posts"] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];

/**
 * One entry in the news tab — a story, or something an account actually posted.
 *
 * A single type with a `kind` discriminant rather than two feeds, because the
 * tab ranks both by time and a reader does not care which pipe a thing came
 * down. The fields that only apply to one kind are nullable rather than split
 * into a union: every consumer here renders both, and a union would make each
 * one narrow before it could read `publishedAt`.
 */
export interface FeedItem {
  id: string;
  kind: "article" | "account";
  /** Headline for a story; the post's own text for an account. */
  body: string;
  url: string;
  /** Publication name, or the account's display name. */
  source: string;
  /** X handle, without the `@`. Null on a story. */
  handle: string | null;
  publishedAt: string;
  /** Tokenized tickers this touches, e.g. `NVDAx`. Empty when none. */
  tickers: string[];
  topic: NewsTopic;
  /** Real article artwork from OG tags. Never a generated placeholder. */
  imageUrl: string | null;
  avatarUrl: string | null;
  summary: string | null;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stonkfolio
// ---------------------------------------------------------------------------

export interface Holding {
  readonly asset: Asset;
  /** Base units held. */
  readonly amount: number;
  readonly valueUsd: number | null;
}
