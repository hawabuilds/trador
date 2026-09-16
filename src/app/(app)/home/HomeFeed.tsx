"use client";

import {useMemo, useState} from "react";
import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {NEW_FEED_MIN_MCAP_USD} from "@/config/feed";
import {AssetList} from "@/components/AssetRow";
import {LoadMore} from "@/components/LoadMore";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HomeTabs, type HomeTab} from "@/components/HomeTabs";
import {useArrivals} from "@/hooks/useArrivals";
import {GraduatingList} from "@/components/GraduatingList";
import {useFeed} from "@/hooks/useFeed";
import {useWatchlistAssets} from "@/hooks/useWatchlist";
import {RocketIcon, StarIcon} from "@/components/ui/Icons";
import {APP_NAME} from "@/config/app";
import {formatUtc} from "@/lib/priceFormat";
import {SECTORS, type SectorId} from "@/lib/sectors";
import type {
  Asset,
  FeedPage,
  Stock,
  StockSort,
  Stonk,
  StonkSort,
  WatchFilter,
} from "@/lib/types";

/**
 * The sort rails under the tabs — the "subheadings" of the feed.
 *
 * Each tab gets the sorts that make sense for what it holds, and only those.
 * A shared rail would have to offer Rewards on the Stocks tab, where the idea
 * is meaningless.
 */
/*
 * `NEW_FEED_MIN_MCAP_USD` is imported rather than declared here: the store
 * applies the same floor when it cuts a page, and two copies of a threshold
 * drift the first time one is tuned.
 */

const STONK_SORTS: FilterOption<StonkSort>[] = [
  {value: "trending", label: "Trending"},
  {
    value: "new",
    label: "New",
    title: "Newest graduations, above $10K market cap",
  },
  {
    value: "graduating",
    label: "Graduating",
    title: "Still on the bonding curve — closest to graduating first",
  },
  {value: "marketCap", label: "Market cap"},
  {
    value: "rewards",
    label: "Rewards",
    title: "Coins whose launch routes a share of every trade to holders, in stock",
  },
];

const STOCK_SORTS: FilterOption<StockSort>[] = [
  {
    value: "launches",
    label: "Most traded against",
    title: "Stocks the most coins are priced in",
  },
  {value: "marketCap", label: "Price"},
  {value: "movers", label: "Movers", title: "Largest move in either direction"},
];

const WATCH_FILTERS: FilterOption<WatchFilter>[] = [
  {value: "all", label: "All"},
  {value: "stonk", label: "Stonks"},
  {value: "stock", label: "Stocks"},
];

export function HomeFeed({
  stonks: initialStonks,
  stocks: initialStocks,
  graduating: initialGraduating,
  now,
}: {
  stonks: FeedPage<Stonk>;
  stocks: FeedPage<Stock>;
  /** Curve launches, server-rendered so the tab is populated on first tap. */
  graduating: readonly Stonk[];
  /** Server render time, so age strings match after hydration. */
  now: number;
}) {
  const [tab, setTab] = useState<HomeTab>("stonks");
  const [stonkSort, setStonkSort] = useState<StonkSort>("trending");
  const [stockSort, setStockSort] = useState<StockSort>("launches");
  const [sector, setSector] = useState<SectorId | "all">("all");
  const [quote, setQuote] = useState<string>("all");
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");

  /*
   * The feed keeps moving after first paint.
   *
   * The server render seeds this, so the list is on screen immediately and
   * React Query adopts it rather than refetching what it was just handed. From
   * there it polls, which is what makes a coin launched a minute ago appear
   * without a reload — the worker writes every ninety seconds and, before
   * this, nothing ever read those writes.
   */
  const feed = useFeed({
    sort: stonkSort,
    quoteTicker: quote === "all" ? null : quote,
    initial: {
      stonks: initialStonks,
      stocks: initialStocks,
      graduating: [...initialGraduating],
    },
  });

  const stonks = feed.stonks;
  const stocks = feed.stocks;

  /**
   * The quote-asset rail, built from what is actually in the feed rather than
   * from the whole registry — so a chip never leads to an empty list, which is
   * the commonest way a filter row lies to someone.
   */
  const quoteOptions = useMemo<FilterOption<string>[]>(() => {
    const counts = new Map<string, number>();
    for (const stonk of stonks.items) {
      counts.set(stonk.quoteTicker, (counts.get(stonk.quoteTicker) ?? 0) + 1);
    }
    return [
      {value: "all", label: "All", hint: String(stonks.items.length)},
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ticker, count]) => ({
          value: ticker,
          label: ticker,
          hint: String(count),
        })),
    ];
  }, [stonks.items]);

  const sectorOptions = useMemo<FilterOption<SectorId | "all">[]>(() => {
    const counts = new Map<SectorId, number>();
    for (const stock of stocks.items) {
      if (stock.sector) counts.set(stock.sector, (counts.get(stock.sector) ?? 0) + 1);
    }
    return [
      {value: "all", label: "All"},
      ...SECTORS.filter((entry) => counts.has(entry.id)).map((entry) => ({
        value: entry.id,
        label: entry.label,
        hint: String(counts.get(entry.id) ?? 0),
      })),
    ];
  }, [stocks.items]);

  const shownStonks = useMemo(() => {
    const list = stonks.items.filter(
      (stonk) => quote === "all" || stonk.quoteTicker === quote,
    );

    switch (stonkSort) {
      case "rewards":
        // Only coins that actually route rewards, ranked by what they paid.
        return list
          .filter((stonk) => stonk.paysHolders)
          .sort((a, b) => (b.rewards24hUsd ?? 0) - (a.rewards24hUsd ?? 0));
      case "marketCap":
        return [...list].sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
      case "new":
        /*
         * Newest graduations, with the dust filtered out.
         *
         * Graduating costs roughly $8,200 of the quote stock and lands a coin
         * near $39K, but the median graduated coin has since fallen to about
         * $2.9K — so without a floor this sort is mostly headstones. 518 of
         * the 694 listed coins sit between $1K and $5K.
         *
         * An **unpriced** coin is kept, deliberately. Null market cap means the
         * decorate pass has not reached it yet, which is the state a coin that
         * graduated ninety seconds ago is in — exactly what this sort is for.
         * Hiding it would filter out the newest thing on the launchpad for
         * being new.
         */
        return list
          .filter(
            (stonk) =>
              stonk.marketCapUsd === null || stonk.marketCapUsd >= NEW_FEED_MIN_MCAP_USD,
          )
          .sort(
            (a, b) =>
              new Date(b.listedAt ?? 0).getTime() - new Date(a.listedAt ?? 0).getTime(),
          );
      default:
        return [...list].sort((a, b) => (b.price.usd ?? 0) - (a.price.usd ?? 0));
    }
  }, [stonks.items, quote, stonkSort]);

  const shownStocks = useMemo(() => {
    const list = stocks.items.filter(
      (stock) => sector === "all" || stock.sector === sector,
    );

    switch (stockSort) {
      case "marketCap":
        return [...list].sort((a, b) => (b.price.usd ?? 0) - (a.price.usd ?? 0));
      // Movers ranks by the size of the move, not its direction — a stock down
      // nine percent is as much of a mover as one up nine.
      case "movers":
        return [...list].sort(
          (a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0),
        );
      default:
        return [...list].sort(
          (a, b) => b.launchesQuotedAgainst - a.launchesQuotedAgainst,
        );
    }
  }, [stocks.items, sector, stockSort]);

  /**
   * The watchlist is fetched rather than filtered out of the feed.
   *
   * A starred coin has to keep working after it scrolls off the feed's first
   * page, and it has to show a live price rather than whatever it cost when it
   * was starred — so the stored keys are resolved against the store on demand.
   */
  const watchlist = useWatchlistAssets(tab === "watchlist");

  const watched = useMemo(
    () =>
      watchlist.assets.filter(
        (asset) => watchFilter === "all" || asset.kind === watchFilter,
      ),
    [watchlist.assets, watchFilter],
  );

  /*
   * Graduating is not an `Asset[]` surface.
   *
   * These coins have no price and no market cap, so they render through their
   * own list rather than being squeezed into a row built around those columns.
   * Kept out of `showing` entirely so the empty states and counts below stay
   * about the tradeable universe.
   */
  const graduating = feed.graduating;
  const showingGraduating = tab === "stonks" && stonkSort === "graduating";

  const showing: readonly Asset[] =
    tab === "stonks"
      ? showingGraduating
        ? []
        : shownStonks
      : tab === "stocks"
        ? shownStocks
        : watched;

  /*
   * Which rows are new since the last poll, so those rows animate in.
   *
   * Without this a coin that arrives between two frames simply exists, and the
   * eye misses it entirely — the feed looks static even while it is updating.
   * Ids present on first load are recorded but not marked, so opening the tab
   * does not animate the whole list.
   */
  const arrivals = useArrivals(showing.map((asset) => `${asset.kind}:${asset.id}`));

  return (
    <div>
      <StickyPageHeader>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[22px] font-extrabold tracking-[-0.035em] text-ink">
            {APP_NAME}
          </span>

          {/*
            Create is the app's one outbound action, so it gets the only filled
            brand-coloured control on the screen.
          */}
          <Link
            href="/create"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-brand-500 px-3.5 text-[12.5px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
          >
            <RocketIcon className="h-[15px] w-[15px]" />
            Create
          </Link>
        </div>

        <HomeTabs value={tab} onChange={setTab} />

        <div className="py-3.5">
          {tab === "stonks" ? (
            <div className="flex flex-col gap-2.5">
              <FilterRail
                label="Sort coins"
                options={STONK_SORTS}
                value={stonkSort}
                onChange={setStonkSort}
              />
              {/*
                The quote filter is hidden on Graduating. That sort swaps the
                set rather than reordering it, and the counts on these chips are
                computed from the graduated feed — so every one of them would be
                wrong. Nothing takes its place: the chip is labelled, the rows
                carry a progress bar, and a sentence repeating that was in the
                way of the list on every visit.
              */}
              {stonkSort === "graduating" ? null : (
                <FilterRail
                  label="Filter by the stock a coin is priced in"
                  options={quoteOptions}
                  value={quote}
                  onChange={setQuote}
                />
              )}
            </div>
          ) : tab === "stocks" ? (
            <div className="flex flex-col gap-2.5">
              <FilterRail
                label="Filter by sector"
                options={sectorOptions}
                value={sector}
                onChange={setSector}
              />
              <FilterRail
                label="Sort stocks"
                options={STOCK_SORTS}
                value={stockSort}
                onChange={setStockSort}
              />
            </div>
          ) : (
            <FilterRail
              label="Filter watchlist"
              options={WATCH_FILTERS}
              value={watchFilter}
              onChange={setWatchFilter}
            />
          )}
        </div>
      </StickyPageHeader>

      {showingGraduating ? (
        graduating.length > 0 ? (
          <GraduatingList coins={graduating} />
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-bold">Nothing close yet</p>
            <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.55] text-muted">
              This shows launches past 10% of their curve. Most never get
              there — only about one in forty graduates.
            </p>
          </div>
        )
      ) : showing.length > 0 ? (
        <>
          <AssetList assets={showing} arrivals={arrivals} now={now} />
          {/*
            Only the Stonks tab pages. Stocks come from the registry — eighty-two
            rows that all arrive at once — and the watchlist is whatever one
            person saved, so neither has a second page to fetch.
          */}
          {tab === "stonks" && feed.hasMore ? (
            <LoadMore onLoad={feed.loadMore} loading={feed.loadingMore} />
          ) : null}
        </>
      ) : tab === "watchlist" && watchlist.isLoading ? (
        <p className="py-10 text-center text-[13.5px] text-muted">Loading your watchlist…</p>
      ) : (
        <EmptyFeed
          tab={tab}
          reason={tab === "stonks" ? stonkSort : undefined}
          watching={watchlist.count > 0}
        />
      )}

      {/*
        Say where the numbers came from. A snapshot presented as live is the
        kind of small dishonesty that costs all the trust at once.
      */}
      {stonks.source === "snapshot" && stonks.capturedAt ? (
        <p className="px-2 pb-2 pt-6 text-center text-[11.5px] leading-[1.55] text-faint">
          Snapshot of real StonkFun launches, captured{" "}
          {formatUtc(stonks.capturedAt)}.
          <br />
          Add an RPC and Supabase for live prices.
        </p>
      ) : null}
    </div>
  );
}

function EmptyFeed({
  tab,
  reason,
  watching,
}: {
  tab: HomeTab;
  reason?: StonkSort;
  /** Whether anything is starred at all, as opposed to filtered out. */
  watching?: boolean;
}) {
  // Starred something and still seeing nothing means the filter did it, not an
  // empty watchlist — telling someone to go star things they already starred is
  // the kind of copy that makes an app feel broken.
  if (tab === "watchlist" && watching) {
    return (
      <p className="py-10 text-center text-[13.5px] text-muted">
        Nothing in your watchlist matches this filter.
      </p>
    );
  }

  if (tab === "watchlist") {
    return (
      <div className="px-6 py-12 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
          <StarIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[14px] font-bold">Nothing watched yet</p>
        <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
          Tap the star on any coin or stock to keep it here.
        </p>
      </div>
    );
  }

  if (reason === "rewards") {
    return (
      <div className="px-6 py-12 text-center">
        <p className="text-[14px] font-bold">No stock payouts recorded yet</p>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.5] text-muted">
          These are coins whose launch routes a share of every trade back to
          holders, paid in the stock they are priced in.
        </p>
      </div>
    );
  }

  return (
    <p className="py-10 text-center text-[13.5px] text-muted">
      Nothing to show here right now.
    </p>
  );
}
