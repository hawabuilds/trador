"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import dynamic from "next/dynamic";
import {useRouter} from "next/navigation";
import {useQueryClient} from "@tanstack/react-query";

import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {RefreshChip} from "@/components/Refresh";
import {accountUrl, tokenUrl} from "@/config/explorer";
import {launchpadFace} from "@/config/launchpads";
import {useAsset, useChart, useTrades} from "@/hooks/useAsset";
import {useLivePrice} from "@/hooks/useLivePrice";
import {usePageRefresh} from "@/hooks/usePageRefresh";
import {useUser} from "@/hooks/useUser";
import {useWalletTrades, WALLET_TRADES_KEY} from "@/hooks/useWalletTrades";
import {hoveredCandleChangePct} from "@/lib/chartLwc";
import {changePctForPoints, mergeTradesIntoChart} from "@/lib/chartLive";
import {TIMEFRAME_MS, chartWindowMs} from "@/lib/chartPlot";
import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {cn} from "@/lib/cn";
import {clock, shortAddress} from "@/lib/format";
import {publishPrice} from "@/lib/livePrice";
import {readChartStyle, writeChartStyle} from "@/lib/localStore";
import {formatLiquidityUsd, formatMarketCapAt, formatPriceUsd} from "@/lib/priceState";
import {SECTOR_LABEL} from "@/lib/sectors";
import {ISSUERS} from "@/lib/stocks/registry";
import type {
  AssetKind,
  AssetPageInitial,
  ChartPoint,
  ChartStyle,
  Timeframe,
  Trade,
} from "@/lib/types";
import {STOCK_TIMEFRAMES, TIMEFRAMES, timeframeLabel} from "@/lib/types";
import {AssetSkeleton} from "./AssetPageSkeleton";
import {FilterRail, type FilterOption} from "./FilterRail";
import {LaunchpadMark} from "./LaunchpadMark";
import {PanelTabs, type PanelTab} from "./PanelTabs";
import {PillRail} from "./PillRail";
import {SocialRow} from "./SocialRow";
import {TradeBar} from "./TradeBar";
import {WatchStar} from "./WatchStar";
import {Avatar} from "./ui/Avatar";
import {PairTicker, TypeBadge, VerifiedTick} from "./ui/Badges";
import {PriceDelta} from "./ui/PriceDelta";
import {SegmentedToggle} from "./ui/SegmentedToggle";
import {
  ArrowUpRightIcon,
  CandleChartIcon,
  ChevronLeftIcon,
  CopyIcon,
  LineChartIcon,
} from "./ui/Icons";
import {PanelError} from "./panels/TradesPanel";

const CommentsPanel = dynamic(() =>
  import("./panels/CommentsPanel").then((m) => ({default: m.CommentsPanel})),
);
const InfoPanel = dynamic(() =>
  import("./panels/InfoPanel").then((m) => ({default: m.InfoPanel})),
);
const NewsPanel = dynamic(() =>
  import("./panels/NewsPanel").then((m) => ({default: m.NewsPanel})),
);
const TradesPanel = dynamic(() =>
  import("./panels/TradesPanel").then((m) => ({default: m.TradesPanel})),
);
const OrderSheet = dynamic(
  () => import("./OrderSheet").then((m) => ({default: m.OrderSheet})),
  {ssr: false},
);
const ReceiveSheet = dynamic(
  () => import("./ReceiveSheet").then((m) => ({default: m.ReceiveSheet})),
  {ssr: false},
);
const PriceChart = dynamic(
  () => import("./PriceChart").then((m) => ({default: m.PriceChart})),
  {
    ssr: false,
    loading: () => <div className="mt-3 h-[220px] animate-pulse rounded-xl bg-wash" />,
  },
);

type PanelKey = "trades" | "comments" | "detail";

type TapeScope = "all" | "mine";

const TAPE_SCOPES: FilterOption<TapeScope>[] = [
  {value: "all", label: "All"},
  {value: "mine", label: "Mine"},
];

/**
 * The chart page, shared by both sides of the universe.
 *
 * One component rather than two because everything below the header is
 * identical — chart, timeframes, trades, comments — and the third tab is the
 * only real fork: a coin gets pool and supply stats, a stock gets coverage.
 */
export function AssetPage({
  kind,
  id,
  requestedTimeframe,
  initial,
}: {
  kind: AssetKind;
  id: string;
  /** `?tf=` from the chart URL. Clicks from the New sort send `1m`. */
  requestedTimeframe?: string | null;
  /** What the server already read, so the page opens drawn rather than loading. */
  initial?: AssetPageInitial | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const at = initial?.at ?? 0;
  const {asset: liveAsset, isLoading, error} = useAsset(kind, id, {data: initial?.asset ?? null, at});
  const asset = liveAsset ?? initial?.asset?.asset ?? null;
  const headerPending = !asset && isLoading;

  const listedAt = asset?.kind === "stonk" ? asset.listedAt : null;
  const coinStatus = asset?.kind === "stonk" ? asset.status : null;
  const autoTimeframe = defaultChartTimeframe({
    kind,
    listedAt,
    coinStatus,
    requested: requestedTimeframe,
  });

  // The picked timeframe is scoped to the asset, so navigating from one coin to
  // another does not carry a 1m pick onto something listed last year.
  const scope = `${kind}:${id}`;
  const [picked, setPicked] = useState<Timeframe | null>(null);
  const [pickedScope, setPickedScope] = useState<string | null>(null);
  const timeframe = pickedScope === scope && picked ? picked : autoTimeframe;
  const setTimeframe = (next: Timeframe) => {
    setPicked(next);
    setPickedScope(scope);
  };

  const tfOptions: readonly Timeframe[] = kind === "stock" ? STOCK_TIMEFRAMES : TIMEFRAMES;
  const [panel, setPanel] = useState<PanelKey>("trades");
  const [scrubbed, setScrubbed] = useState<ChartPoint | null>(null);
  const [orderSide, setOrderSide] = useState<"buy" | "sell" | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [chartStyle, setChartStyle] = useState<ChartStyle>("line");
  useEffect(() => setChartStyle(readChartStyle()), []);

  const chart = useChart(kind, id, timeframe, {data: initial?.chart ?? null, at});
  const trades = useTrades(kind, id, true, {data: initial?.trades ?? null, at});

  /*
   * Your own trades in this asset, from the same wallet history the Stonkfolio
   * lists. Only fetched once "Mine" is picked, and shown in the tape's own
   * layout so the two read the same way.
   */
  const {wallet} = useUser();

  usePageRefresh(
    "asset",
    useCallback(async () => {
      const mint = asset?.mint ?? null;
      await Promise.all([
        queryClient.refetchQueries({queryKey: ["asset", kind, id]}),
        queryClient.refetchQueries({
          predicate: (query) =>
            query.queryKey[0] === "chart" &&
            query.queryKey[1] === kind &&
            query.queryKey[2] === id,
        }),
        queryClient.refetchQueries({queryKey: ["trades", kind, id]}),
        queryClient.refetchQueries({queryKey: ["asset-news", id]}),
        queryClient.refetchQueries({
          predicate: (query) =>
            query.queryKey[0] === "comments" &&
            query.queryKey[1] === kind &&
            query.queryKey[2] === id,
        }),
        wallet && mint
          ? queryClient.refetchQueries({queryKey: [WALLET_TRADES_KEY, wallet, mint]})
          : Promise.resolve(),
      ]);
    }, [queryClient, kind, id, wallet, asset?.mint]),
  );
  const [tapeScope, setTapeScope] = useState<TapeScope>("all");
  const mine = useWalletTrades(wallet, {
    mint: asset?.mint ?? null,
    enabled: panel === "trades" && tapeScope === "mine" && Boolean(asset),
  });
  const mineAsTape = useMemo<Trade[]>(
    () =>
      mine.trades.map((trade) => ({
        id: `${trade.signature}:${trade.mint}`,
        side: trade.side,
        amount: trade.amount,
        // Unpriced stays unpriced: the tape renders a dash, not $0.
        amountUsd: trade.valueUsd ?? Number.NaN,
        priceUsd: trade.priceUsd ?? Number.NaN,
        maker: wallet ?? "",
        txHash: trade.signature,
        makerHandle: null,
        at: trade.at,
      })),
    [mine.trades, wallet],
  );

  const symbol = asset?.kind === "stock" ? asset.ticker : (asset?.symbol ?? "");

  const livePoints = useMemo(
    () =>
      mergeTradesIntoChart(
        chart.points,
        trades.trades,
        TIMEFRAME_MS[chart.resolvedTimeframe],
        // Every fill from chain: let it redraw the candles it spans.
        {complete: trades.complete},
      ),
    [chart.points, chart.resolvedTimeframe, trades.trades, trades.complete],
  );

  /**
   * The tape is the freshest thing this app has, so it publishes into the
   * shared price store. The feed row for this same asset reads it too, which is
   * what keeps two surfaces from showing two different numbers for one coin.
   */
  const newestFill = trades.trades[0];
  useEffect(() => {
    if (!newestFill) return;
    publishPrice(id, newestFill.priceUsd, Date.parse(newestFill.at));
  }, [id, newestFill]);

  const livePrice = useLivePrice(id);
  const liveChange = changePctForPoints(livePoints) ?? asset?.changePct ?? 0;
  const positive = liveChange >= 0;

  const tabs: PanelTab<PanelKey>[] = useMemo(
    () => [
      {value: "trades", label: "Trades"},
      {value: "comments", label: "Comments"},
      {value: "detail", label: kind === "stock" ? "About" : "Info"},
    ],
    [kind],
  );

  if (!asset) {
    if (headerPending) return <AssetSkeleton />;
    return (
      <div className={APP_SCROLL_PAD_TOP}>
        <BackButton onClick={() => router.push("/home")} />
        <p className="mt-5 text-[14px] text-muted">
          {error?.message ?? "That asset is not listed here."}
        </p>
      </div>
    );
  }

  // While scrubbing, the header reports the point under the finger; otherwise
  // the live price. A hovered candle's percentage is that bar's open→close, not
  // the cumulative move across the window.
  const shownPrice =
    scrubbed?.price ?? livePrice ?? newestFill?.priceUsd ?? asset.price.usd ?? 0;
  const shownChange = scrubbed
    ? (hoveredCandleChangePct(livePoints, scrubbed) ?? liveChange)
    : liveChange;

  // One calculation, one price. Both live in shared modules precisely so this
  // header and the panel further down the page cannot disagree.
  const shownMarketCap = formatMarketCapAt(asset, shownPrice);

  return (
    <div className={cn(APP_SCROLL_PAD_TOP, "pb-[calc(84px+env(safe-area-inset-bottom))]")}>
      <BackButton onClick={() => router.back()} />

      {asset.kind === "stock" ? (
        // A tokenized equity is listed by symbol, with no artwork — the way a
        // brokerage lists it — so the company name carries the header.
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-faint">
              {asset.ticker}
            </span>
            <VerifiedTick size={14} />
            <TypeBadge kind={asset.stockKind} />
            <WatchStar
              kind={asset.kind}
              id={asset.id}
              addPrice={asset.price.usd ?? 0}
              className="-my-1 ml-auto"
            />
          </div>
          <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-[-0.035em]">
            {asset.name}
          </h1>
        </div>
      ) : (
        <div className="mt-3 flex items-start gap-3">
          <Avatar name={symbol} src={asset.imageUrl} seed={asset.mint} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className="truncate text-[20px] font-extrabold tracking-[-0.03em]">
                {symbol}
              </h1>
              <WatchStar
                kind={asset.kind}
                id={asset.id}
                addPrice={asset.price.usd ?? 0}
              />
            </div>
            <div className="-mt-0.5 truncate text-[13px] font-semibold text-faint">
              {asset.name}
            </div>
          </div>

          {/*
            The project's own links, when it has any. Aligned to the avatar
            rather than dropped below the chips, because these are about who
            launched the coin — the same question the name and picture answer —
            and a project with none renders nothing at all rather than a row of
            dead icons.
          */}
          {asset.socials ? (
            <SocialRow socials={asset.socials} className="-mr-1.5 -mt-1 shrink-0" />
          ) : null}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {asset.kind === "stock" ? (
          <>
            {asset.sector ? (
              <span className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-muted">
                {SECTOR_LABEL.get(asset.sector)}
              </span>
            ) : null}
            <span className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-muted">
              {ISSUERS[asset.issuer].label}
            </span>
            {/*
              Said out loud on the page, not buried in a tooltip. A pre-IPO name
              has no public market, so nothing here is an exchange quote.
            */}
            {asset.priceAuthority === "none" ? (
              <span
                title="Not publicly listed, so no exchange quote exists"
                className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-faint"
              >
                Pool-priced
              </span>
            ) : null}
          </>
        ) : (
          <>
            <PairTicker ticker={asset.quoteTicker} />
            {asset.paysHolders ? (
              <span
                title={`A share of every trade goes back to holders, in ${asset.quoteTicker}`}
                className="rounded-[8px] bg-[var(--overlay-wash)] px-2 py-1 text-[11.5px] font-extrabold text-price-up"
              >
                Pays {asset.quoteTicker}
              </span>
            ) : null}
            {/*
              Links to this coin on its launchpad, not to the launchpad's home
              page. Someone tapping this wants to see the coin where it was
              launched — to check the curve, the replies, our attribution —
              and a drop onto a front page makes them search for it again.
            */}
            <a
              href={launchpadFace(asset.launchpad).coinUrl(asset.mint)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${asset.symbol} on ${launchpadFace(asset.launchpad).label}`}
              className="flex items-center gap-1.5 rounded-[8px] bg-[var(--overlay-wash)] py-1 pl-1 pr-2 text-[11.5px] font-extrabold transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              <LaunchpadMark launchpad={asset.launchpad} size={16} />
              {launchpadFace(asset.launchpad).label}
            </a>
          </>
        )}
      </div>

      {/*
        The mint sits on its own line rather than in the rail above. It is the
        longest chip by far and the only one people copy rather than read, so
        sharing a wrapping row pushed the others around by address length.
      */}
      <div className="mt-2 flex">
        <MintChip mint={asset.mint} />
      </div>

      {asset.kind === "stock" && asset.description ? (
        <p className="mt-3 text-[13px] leading-[1.55] text-muted">{asset.description}</p>
      ) : null}

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="tabular-nums text-[32px] font-extrabold leading-none tracking-[-0.035em]">
            {formatPriceUsd(shownPrice)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13.5px] font-bold">
            <PriceDelta value={shownChange} />
            <span className="font-semibold text-faint">
              {scrubbed
                ? clock(scrubbed.t)
                : timeframeLabel(timeframe, chart.resolvedTimeframe)}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            {asset.kind === "stock" ? "Company cap" : "Market cap"}
          </div>
          <div className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
            {shownMarketCap}
          </div>
          {asset.kind === "stonk" ? (
            <div className="tabular-nums mt-0.5 inline-flex items-center gap-1 rounded-[6px] bg-[var(--overlay-wash)] px-1.5 py-[3px] text-[11px] font-bold">
              <span className="text-faint">Liq</span>
              <span className="text-muted">{formatLiquidityUsd(asset.liquidityUsd)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {chart.error && livePoints.length < 2 ? (
        <div className="mt-3 h-[220px] rounded-xl bg-wash">
          <PanelError message={chart.error} onRetry={chart.retry} />
        </div>
      ) : (
        <PriceChart
          points={livePoints}
          positive={positive}
          windowMs={chartWindowMs(timeframe)}
          emptyLabel={`Not enough history for ${timeframe}`}
          style={chartStyle}
          showBaseline={asset.kind === "stock"}
          floorPrice={livePoints[0]?.price}
          onScrub={setScrubbed}
          className="mt-3"
        />
      )}

      <div className="mb-5 mt-2 flex items-center gap-2">
        <PillRail
          label="Chart timeframe"
          options={tfOptions}
          value={timeframe}
          resolvedValue={chart.resolvedTimeframe}
          onChange={setTimeframe}
          positive={positive}
          className="mb-0 mt-0 min-w-0 flex-1"
        />
        <RefreshChip label="Refresh prices and trades" />
        <SegmentedToggle
          value={chartStyle}
          onChange={(next) => {
            setChartStyle(next);
            writeChartStyle(next);
          }}
          options={[
            {value: "line", label: "Line", icon: <LineChartIcon className="h-3.5 w-3.5" />},
            {
              value: "candles",
              label: "Candles",
              icon: <CandleChartIcon className="h-3.5 w-3.5" />,
            },
          ]}
        />
      </div>

      <PanelTabs tabs={tabs} value={panel} onChange={setPanel} />

      <div className="pt-3">
        {panel === "trades" ? (
          <>
            {wallet ? (
              <div className="pb-3">
                <FilterRail
                  label="Whose trades"
                  options={TAPE_SCOPES}
                  value={tapeScope}
                  onChange={setTapeScope}
                />
              </div>
            ) : null}
            {tapeScope === "mine" && wallet ? (
              <TradesPanel
                trades={mineAsTape}
                symbol={symbol}
                isLoading={mine.isLoading}
                error={mine.error}
                onRetry={mine.retry}
                emptyLabel={mine.notice ?? `You haven't traded ${symbol} from this wallet yet.`}
              />
            ) : (
              <TradesPanel
                trades={trades.trades}
                symbol={symbol}
                isLoading={trades.isLoading}
                error={trades.error}
                onRetry={trades.retry}
              />
            )}
          </>
        ) : panel === "comments" ? (
          <CommentsPanel
            kind={asset.kind}
            assetId={asset.id}
            symbol={symbol}
            imageUrl={asset.kind === "stonk" ? asset.imageUrl : null}
          />
        ) : asset.kind === "stonk" ? (
          <InfoPanel stonk={asset} />
        ) : (
          <StockAbout
            issuer={ISSUERS[asset.issuer].label}
            launches={asset.launchesQuotedAgainst}
            poolPriced={asset.priceAuthority === "none"}
            ticker={asset.ticker}
          />
        )}
      </div>

      <TradeBar
        symbol={symbol}
        onBuy={() => setOrderSide("buy")}
        onSell={() => setOrderSide("sell")}
      />

      <OrderSheet
        asset={orderSide ? asset : null}
        side={orderSide ?? "buy"}
        onClose={() => setOrderSide(null)}
        onReceive={wallet ? () => setReceiveOpen(true) : undefined}
      />

      {wallet ? (
        <ReceiveSheet
          open={receiveOpen}
          onClose={() => setReceiveOpen(false)}
          wallet={wallet}
        />
      ) : null}
    </div>
  );
}

function StockAbout({
  issuer,
  launches,
  poolPriced,
  ticker,
}: {
  issuer: string;
  launches: number;
  poolPriced: boolean;
  ticker: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface-card shadow-card">
      <AboutRow label="Issuer" value={issuer} />
      <AboutRow label="Coins priced in it" value={launches.toLocaleString("en-US")} />
      <AboutRow
        label="Price source"
        value={poolPriced ? "Pool only" : "Exchange-backed"}
      />
      <div className="px-4 py-3 text-[12.5px] leading-[1.55] text-muted">
        {poolPriced
          ? `${ticker} has no public market behind it, so its price is whatever the ` +
            `pool says. Treat it as a market's opinion, not a quote.`
          : `${ticker} is backed one-for-one by shares in custody, so its price ` +
            `tracks the underlying equity around the clock.`}
      </div>
    </div>
  );
}

function AboutRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40">
      <span className="text-[12.5px] font-bold text-faint">{label}</span>
      <span className="tabular-nums text-[13px] font-extrabold">{value}</span>
    </div>
  );
}

function BackButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="-ml-1.5 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
    >
      <ChevronLeftIcon className="h-5 w-5" />
    </button>
  );
}

function MintChip({mint}: {mint: string}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <span className="flex items-center gap-0.5 rounded-[8px] bg-[var(--overlay-wash)] py-0.5 pl-2 pr-0.5 text-[11.5px] font-semibold text-muted">
      <span className="font-mono text-[11px]">
        {copied ? "Copied" : shortAddress(mint, 5)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy mint address"
        className="grid h-6 w-6 place-items-center rounded-full text-faint transition-colors hover:text-ink"
      >
        <CopyIcon className="h-3 w-3" />
      </button>
      <a
        href={tokenUrl(mint)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View mint on the explorer"
        className="grid h-6 w-6 place-items-center rounded-full text-faint transition-colors hover:text-ink"
      >
        <ArrowUpRightIcon className="h-3 w-3" />
      </a>
    </span>
  );
}
