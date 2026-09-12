/**
 * The floor under the feed.
 *
 * The architectural promise this app inherits is that the list never goes
 * blank: the chain decides what exists, the store keeps it, and providers only
 * decorate it. A fresh checkout has no store — so it reads this instead, a
 * captured snapshot of real graduated stock-paired launches.
 *
 * Real mainnet data rather than a hand-written fixture on purpose. A made-up
 * feed drifts from the product and eventually misrepresents it; a captured one
 * stays honest as long as the UI says it is a snapshot, which is what
 * `FeedPage.source` and `capturedAt` are for.
 *
 * Regenerate with `npm run seed:snapshot`.
 */

import {assertPubkey} from "@/lib/pubkey";
import {sectorFor} from "@/lib/sectors";
import {stocksByPopularity} from "@/lib/stocks/registry";
import type {FeedPage, PriceState, Stock, Stonk} from "@/lib/types";
import {type QuoteKind} from "@/lib/universe";

import SNAPSHOT from "./snapshot.generated.json" with {type: "json"};

interface RawStonk {
  mint: string;
  pool: string;
  symbol: string;
  name: string;
  configKind: string;
  paysHolders: boolean;
  quoteMint: string;
  quoteTicker: string;
  quoteKind: string;
  creator: string;
  priceUsd: number | null;
  changePct: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  isTradeable: boolean | null;
  listedAt: string | null;
}

interface RawStock {
  priceUsd: number | null;
  changePct: number | null;
  liquidityUsd: number | null;
  underlying: {price: number | null; mcap: number | null; source: string} | null;
}

const SNAP = SNAPSHOT as {
  capturedAt?: string;
  stonks?: RawStonk[];
  stocks?: Record<string, RawStock>;
};

const CAPTURED_AT = SNAP.capturedAt ?? null;
const RAW_STOCKS = SNAP.stocks ?? {};

function priceFrom(usd: number | null | undefined): PriceState {
  // A missing price is `no_pool`, never $0. Rendering an unknown price as zero
  // is the one formatting decision a user cannot tell is wrong.
  if (usd === null || usd === undefined || !Number.isFinite(usd)) {
    return {usd: null, source: null, status: "no_pool", at: CAPTURED_AT};
  }
  return {usd, source: "snapshot", status: "priced", at: CAPTURED_AT};
}

const STONKS: readonly Stonk[] = (SNAP.stonks ?? []).map((raw) => {
  const mint = assertPubkey(raw.mint, "snapshot stonk mint");
  return {
    kind: "stonk" as const,
    id: mint,
    mint,
    pool: assertPubkey(raw.pool, "snapshot pool"),
    symbol: raw.symbol,
    name: raw.name,
    launchpad: "stonkfun" as const,
    creator: assertPubkey(raw.creator, "snapshot creator"),
    status: "listed" as const,
    quoteMint: assertPubkey(raw.quoteMint, "snapshot quote mint"),
    quoteTicker: raw.quoteTicker,
    quoteKind: raw.quoteKind as QuoteKind,
    paysHolders: raw.paysHolders,
    // Payouts are not indexed yet. Null rather than 0, so the Rewards sort does
    // not claim every rewards launch has paid out nothing.
    rewards24hUsd: null,
    price: priceFrom(raw.priceUsd),
    // Measured: price × real supply, computed at capture time.
    marketCapUsd: raw.marketCapUsd,
    volume24hUsd: null,
    liquidityUsd: raw.liquidityUsd,
    isTradeable: raw.isTradeable,
    changePct: raw.changePct,
    series: [],
    listedAt: raw.listedAt,
  } satisfies Stonk;
});

export function snapshotStonks(): FeedPage<Stonk> {
  return {items: STONKS, cursor: null, source: "snapshot", capturedAt: CAPTURED_AT};
}

/**
 * The Stocks tab, built from the verified registry and decorated with captured
 * prices.
 *
 * Default ranking is how many launches are priced against each one, because
 * that is the app's own signal rather than a borrowed market-cap table — and it
 * answers the question a Trador user actually has: which stock is the scene
 * trading in?
 */
export function snapshotStocks(): FeedPage<Stock> {
  const items: Stock[] = stocksByPopularity().map((stock) => {
    const raw = RAW_STOCKS[stock.mint];
    return {
      kind: "stock" as const,
      id: stock.ticker,
      mint: stock.mint,
      ticker: stock.ticker,
      name: stock.name,
      issuer: stock.issuer,
      stockKind: stock.kind,
      priceAuthority: stock.priceAuthority,
      decimals: stock.decimals,
      sector: sectorFor(stock.ticker),
      launchesQuotedAgainst: stock.launchesQuotedAgainst,
      price: priceFrom(raw?.priceUsd),
      // The underlying equity's own market cap when the provider carries it —
      // the company's, not the token's, which is why it is only ever shown
      // labelled as the underlying.
      marketCapUsd: raw?.underlying?.mcap ?? null,
      changePct: raw?.changePct ?? null,
      series: [],
    } satisfies Stock;
  });

  return {items, cursor: null, source: "snapshot", capturedAt: CAPTURED_AT};
}

export function snapshotStonk(mint: string): Stonk | null {
  return STONKS.find((stonk) => stonk.mint === mint) ?? null;
}

export function snapshotStock(ticker: string): Stock | null {
  return snapshotStocks().items.find((stock) => stock.ticker === ticker) ?? null;
}
