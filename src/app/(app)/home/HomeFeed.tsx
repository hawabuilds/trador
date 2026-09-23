"use client";

import dynamic from "next/dynamic";
import {useCallback, useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {usePathname, useRouter, useSearchParams} from "next/navigation";
import {useQueryClient} from "@tanstack/react-query";

import {StickyPageHeader} from "@/components/AppShell";
import {filterNewFeedStonks, filterTrendingFeedStonks} from "@/config/feed";
import {isGraduatedListedStonk, sortStonksGraduating} from "@/lib/graduatingFeedSort";
import {AssetList} from "@/components/AssetRow";
const CreateSheet = dynamic(
  () => import("@/components/CreateSheet").then((m) => ({default: m.CreateSheet})),
  {ssr: false},
);
import {LoadMore} from "@/components/LoadMore";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HomeTabs, type HomeTab} from "@/components/HomeTabs";
import {useArrivals} from "@/hooks/useArrivals";
import {GraduatingList} from "@/components/GraduatingList";
import {useFeed} from "@/hooks/useFeed";
import {usePageRefresh} from "@/hooks/usePageRefresh";
import {useWatchlistAssets} from "@/hooks/useWatchlist";
import {RocketIcon, StarIcon} from "@/components/ui/Icons";
import {TradorMark} from "@/components/ui/TradorMark";
import {TradorWordmark} from "@/components/ui/TradorWordmark";
import {formatUtc} from "@/lib/priceFormat";
import {sortStonksTrending} from "@/lib/trendingFeedSort";
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
 * A shared rail would have to offer Graduating on the Stocks tab, where the idea
 * is meaningless.
 */
/*
 * `filterNewFeedStonks` is imported rather than reimplemented here: the store
 * applies the same floor when it cuts a page, and two copies of a threshold
 * drift the first time one is tuned.
 */

/**
 * A query parameter, or the default.
 *
 * Validated against the allowed values rather than cast: the URL is user input,
 * and `?sort=<script>` reaching a component as a sort key is how a reflected
 * value becomes a rendered one.
 */
function readParam<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const HOME_TABS = ["watchlist", "stonks", "stocks"] as const satisfies readonly HomeTab[];

const STONK_SORTS: FilterOption<StonkSort>[] = [
  {value: "trending", label: "Trending"},
  {
    value: "new",
    label: "New",
    title: "Newest graduations — fresh launches always; older ones above $10K market cap",
  },
  {
    value: "graduating",
    label: "Graduating",
    title: "Still on the bonding curve — closest first, hottest activity at each step",
  },
  {value: "marketCap", label: "Market cap"},
];

const STONK_SORT_VALUES = STONK_SORTS.map((option) => option.value);

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
  initialStonkSort,
  seedGraduating,
  now,
  active = true,
}: {
  stonks: FeedPage<Stonk>;
  stocks: FeedPage<Stock>;
  /** Curve launches, server-rendered so the tab is populated on first tap. */
  graduating: readonly Stonk[];
  initialStonkSort: Exclude<StonkSort, "graduating">;
  seedGraduating: boolean;
  /** Server render time, so age strings match after hydration. */
  now: number;
  /** False while Home is kept alive but another tab is showing. */
  active?: boolean;
}) {
  /*
   * Which tab and sort are showing lives in the URL, not only in state.
   *
   * Opening a coin pushes a history entry; coming back restores this screen
   * from that entry. With the selection held only in `useState` it was rebuilt
   * from its defaults, so a visitor who browsed New, tapped a coin and pressed
   * back landed on Trending — having lost their place in a list they were
   * halfway down.
   *
   * Chip taps `replace` rather than `push`, so the back button steps out of the
   * feed instead of walking back through every filter touched on the way in.
   */
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<HomeTab>(
    () => readParam(params.get("tab"), HOME_TABS, "stonks"),
  );
  const [stonkSort, setStonkSort] = useState<StonkSort>(
    () => readParam(params.get("sort"), STONK_SORT_VALUES, "trending"),
  );
  const [stockSort, setStockSort] = useState<StockSort>("launches");
  const [sector, setSector] = useState<SectorId | "all">("all");
  const [quote, setQuote] = useState<string>(() => params.get("quote") ?? "all");
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");
  // The launch pop-up. `/create` redirects here with `?create=1`, so a link to
  // Create from anywhere opens it over the feed.
  const [createOpen, setCreateOpen] = useState(() => params.get("create") === "1");
  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    if (params.get("create")) router.replace(pathname, {scroll: false});
  }, [params, router, pathname]);

  const prefetchNewFeed = useCallback(() => {
    const quoteKey = quote === "all" ? "all" : quote;
    void queryClient.prefetchQuery({
      queryKey: ["feed", "new", quoteKey, false, false],
      queryFn: async () => {
        const search = new URLSearchParams({sort: "new"});
        if (quote !== "all") search.set("quote", quote);
        const response = await fetch(`/api/feed?${search}`);
        if (!response.ok) throw new Error("Could not load the feed.");
        return (await response.json()) as {
          stonks: FeedPage<Stonk>;
          stocks: FeedPage<Stock> | null;
          graduating: Stonk[] | null;
        };
      },
      staleTime: 15_000,
    });
  }, [queryClient, quote]);

  const stonkSortOptions = useMemo(
    () =>
      STONK_SORTS.map((option) =>
        option.value === "new"
          ? {...option, onPointerDown: prefetchNewFeed}
          : option,
      ),
    [prefetchNewFeed],
  );

  /*
   * State to URL, one way.
   *
   * Only the values worth returning to are written, and defaults are left out
   * entirely so the common case stays a clean `/home`. The guard matters: a
   * `replace` on every render would fight the router and, on some Next
   * versions, loop.
   */
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== "stonks") next.set("tab", tab);
    if (stonkSort !== "trending") next.set("sort", stonkSort);
    if (quote !== "all") next.set("quote", quote);

    const query = next.toString();
    const current = params.toString();
    if (query === current) return;

    router.replace(query ? `${pathname}?${query}` : pathname, {scroll: false});
  }, [tab, stonkSort, quote, params, pathname, router]);

  /*
   * No URL-to-state effect, deliberately.
   *
   * There was one, and it made fast filter switching glitch: a chip tap sets
   * state, the effect above schedules a `replace`, and before that lands this
   * effect fired with the *previous* URL and set the state straight back — so a
   * quick second tap was reverted and the chips visibly bounced. The URL is
   * written from state and never read back while mounted.
   *
   * Nothing is lost by that. Returning from a coin page remounts this screen,
   * and the `useState` initialisers read the URL then; and because every write
   * is a `replace`, there are no history entries within this page for a back
   * press to step through.
   */

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
    include: {
      stocks: tab === "stocks",
      graduating: tab === "stonks" && stonkSort === "graduating",
    },
    initial: {
      stonks: initialStonks,
      stocks: initialStocks,
      graduating: [...initialGraduating],
    },
    initialStonkSort,
    seedGraduating,
    enabled: active,
  });

  usePageRefresh(
    "home",
    useCallback(async () => {
      await Promise.all([
        queryClient.refetchQueries({queryKey: ["feed"]}),
        queryClient.refetchQueries({queryKey: ["watchlist"]}),
        queryClient.refetchQueries({queryKey: ["watchlist-assets"]}),
      ]);
    }, [queryClient]),
  );

  const stonks = feed.stonks;
  const stocks = feed.stocks;

  /**
   * Quote filter chips — totals from the store for this sort, not one page.
   *
   * Counting `stonks.items` capped at forty and shrank when a quote filter was
   * on the API, so a chip's hint rarely matched the list after a tap.
   */
  const quoteOptions = useMemo<FilterOption<string>[]>(() => {
    const server = stonks.quoteCounts;
    if (server) {
      return [
        {value: "all", label: "All", hint: String(server.total)},
        ...Object.entries(server.byTicker)
          .sort((a, b) => b[1] - a[1])
          .map(([ticker, count]) => ({
            value: ticker,
            label: ticker,
            hint: String(count),
          })),
      ];
    }

    const listed = stonks.items.filter(isGraduatedListedStonk);
    const base =
      stonkSort === "new"
        ? filterNewFeedStonks(listed)
        : stonkSort === "trending"
          ? filterTrendingFeedStonks(listed)
          : listed;
    const counts = new Map<string, number>();
    for (const stonk of base) {
      counts.set(stonk.quoteTicker, (counts.get(stonk.quoteTicker) ?? 0) + 1);
    }
    return [
      {value: "all", label: "All", hint: String(base.length)},
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ticker, count]) => ({
          value: ticker,
          label: ticker,
          hint: String(count),
        })),
    ];
  }, [stonks.quoteCounts, stonks.items, stonkSort]);

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
      (stonk) =>
        isGraduatedListedStonk(stonk) &&
        (quote === "all" || stonk.quoteTicker === quote),
    );

    switch (stonkSort) {
      case "trending":
        return sortStonksTrending(filterTrendingFeedStonks(list));
      case "marketCap":
        return [...list].sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0));
      case "new":
        /*
         * Server order is `graduated_at desc` with the floor in SQL — do not
         * re-sort here or keyset pages disagree with what is on screen.
         *
         * Pending launches never reach this list: the store only reads
         * `status = listed`, and the guard above drops any row that slipped
         * through snapshot or placeholder data.
         */
        return filterNewFeedStonks(list);
      default:
        return list;
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
  const watchlist = useWatchlistAssets(active && tab === "watchlist");

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
  const graduating = useMemo(
    () => (feed.graduating ? sortStonksGraduating(feed.graduating) : []),
    [feed.graduating],
  );
  const showingGraduating = tab === "stonks" && stonkSort === "graduating";

  const stonksListLoading =
    tab === "stonks" &&
    !showingGraduating &&
    stonkSort === "new" &&
    feed.stonksLoading;

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
  const arrivals = useArrivals(
    showing.map((asset) => `${asset.kind}:${asset.id}`),
    1200,
    // Which list this is. Includes whether the rows are still the previous
    // list's placeholder, so the baseline is taken again when the real rows
    // for the new chip arrive — otherwise that swap would animate every row.
    `${tab}|${stonkSort}|${stockSort}|${sector}|${quote}|${watchFilter}|${feed.isPlaceholder}`,
  );

  return (
    <div>
      <StickyPageHeader>
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2.5 text-ink">
            <TradorMark size={26} className="text-brand-500" />
            <TradorWordmark className="text-[19px]" />
          </span>

          {/*
            Create is the app's one outbound action, so it gets the only filled
            brand-coloured control on the screen.
          */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-brand-500 px-3.5 text-[12.5px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
          >
            <RocketIcon className="h-[15px] w-[15px]" />
            Create
          </button>
        </div>

        <HomeTabs value={tab} onChange={setTab} />

        <div className="py-3.5">
          {tab === "stonks" ? (
            <div className="flex flex-col gap-2.5">
              <FilterRail
                label="Sort coins"
                options={stonkSortOptions}
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
        feed.graduatingLoading ? (
          <AssetListSkeleton label="Loading graduating launches" />
        ) : graduating.length > 0 ? (
          <GraduatingList coins={graduating} now={now} />
        ) : (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-bold">Nothing close yet</p>
            <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.55] text-muted">
              This shows launches past 10% of their curve. Most never get
              there — only about one in forty graduates.
            </p>
          </div>
        )
      ) : stonksListLoading ? (
        <AssetListSkeleton label="Loading coins" />
      ) : showing.length > 0 ? (
        <>
          {/*
            Dimmed while these are the previous chip's rows (e.g. Market cap
            after Trending). New uses a skeleton instead — empty beats wrong
            rows under that chip.
          */}
          <div
            className="transition-opacity duration-150"
            style={{opacity: tab === "stonks" && feed.isPlaceholder ? 0.45 : 1}}
            aria-busy={tab === "stonks" && feed.isPlaceholder}
          >
            <AssetList assets={showing} arrivals={arrivals} now={now} />
          </div>
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
        <EmptyFeed tab={tab} watching={watchlist.count > 0} />
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

      <CreateSheet open={createOpen} onClose={closeCreate} />
    </div>
  );
}

function AssetListSkeleton({label}: {label: string}) {
  return (
    <ul className="-mx-[22px]" aria-busy aria-label={label}>
      {Array.from({length: 8}, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-[22px] py-[13px]">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-raised" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-28 animate-pulse rounded-md bg-surface-raised" />
            <div className="h-3 w-36 animate-pulse rounded-md bg-surface-raised" />
          </div>
          <div className="h-4 w-14 animate-pulse rounded-md bg-surface-raised" />
        </li>
      ))}
    </ul>
  );
}

function EmptyFeed({
  tab,
  watching,
}: {
  tab: HomeTab;
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

  return (
    <p className="py-10 text-center text-[13.5px] text-muted">
      Nothing to show here right now.
    </p>
  );
}
