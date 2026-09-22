"use client";

import Link from "next/link";

import {usePrefetchAssetPage} from "@/hooks/useAsset";
import {cn} from "@/lib/cn";
import {
  formatMarketCapUsd,
  formatPriceUsd,
  formatVolumeUsd,
  isPriced,
  tokenAge,
} from "@/lib/priceFormat";
import {SECTOR_LABEL} from "@/lib/sectors";
import type {Asset} from "@/lib/types";
import {Sparkline} from "./Sparkline";
import {Avatar} from "./ui/Avatar";
import {LaunchpadMark} from "./LaunchpadMark";
import {NoLiquidityChip, PairTicker, VerifiedTick} from "./ui/Badges";
import {PriceDelta} from "./ui/PriceDelta";

export function assetHref(asset: Asset): string {
  return asset.kind === "stock"
    ? `/stock/${asset.ticker}`
    : `/stonk/${asset.mint}`;
}

/**
 * One row in the feed.
 *
 * Deliberately not a card. A feed is scanned down a single column of tickers,
 * and boxing each entry puts a border between the eye and the next symbol.
 *
 * The two sides of the universe differ in exactly two ways, both following what
 * a brokerage already does: a stock carries a verified tick and no avatar,
 * because an equity is listed by symbol alone, and its second line is the
 * sector rather than pool volume, because that is what a stock is grouped by.
 */
export function AssetRow({
  asset,
  fresh,
  now,
}: {
  asset: Asset;
  fresh?: boolean;
  /** Passed in so age strings are identical on the server and after hydration. */
  now?: number;
}) {
  const stock = asset.kind === "stock";
  const symbol = stock ? asset.ticker : asset.symbol;
  const shownPrice = asset.price.usd;
  const prefetchPage = usePrefetchAssetPage(asset);

  return (
    <Link
      href={assetHref(asset)}
      prefetch
      {...prefetchPage}
      className={cn(
        "flex items-center gap-3 px-[22px] py-[13px] transition-colors duration-150 hover:bg-[var(--overlay-wash)]",
        fresh && "trade-in",
      )}
    >
      {stock ? null : (
        <Avatar name={symbol} src={asset.imageUrl} seed={asset.mint} size={40} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
            {symbol}
          </span>
          {stock ? (
            <VerifiedTick />
          ) : (
            <>
              <PairTicker ticker={asset.quoteTicker} />
              {/*
                Only when the flag is actually false. A coin whose liquidity has
                not been measured is null, and calling that illiquid would be a
                guess printed as a fact.
              */}
              {asset.isTradeable === false ? <NoLiquidityChip /> : null}
            </>
          )}
        </div>

        <div className="tabular-nums mt-[3px] flex items-center gap-2.5 truncate text-[12.5px] font-semibold">
          {stock ? (
            <span className="text-faint">
              {/*
                The category, and nothing else.

                Falling back to `asset.name` printed the issuer's own product
                string — "Krispy Kreme, Inc. Common Stock - Backpack
                Securities" — in the slot where every other row shows one word.
                Which issuer minted a stock belongs on the stock's page, where
                there is room to say it plainly; here it is noise that pushes
                the price off the row. An unmapped ticker shows nothing rather
                than something long.
              */}
              {asset.sector ? SECTOR_LABEL.get(asset.sector) : null}
            </span>
          ) : (
            <>
              {/*
                The mark only, not the full chip — a dense row has no space for
                a second word, and the logo alone tells the two launchpads
                apart at a glance, which is all this line needs to do.

                Deliberately not a link. The whole row is already an `<a>`, and
                an anchor inside an anchor is invalid HTML that browsers
                resolve by silently breaking the outer one. The clickable
                version, which opens the coin on its launchpad, lives on the
                coin's own page where it is not nested.
              */}
              <LaunchpadMark launchpad={asset.launchpad} size={14} />
              <span className="text-faint">
                {asset.rewards24hUsd && asset.rewards24hUsd > 0
                  ? `${formatVolumeUsd(asset.rewards24hUsd)} Rewards`
                  : asset.volume24hUsd !== null
                    ? `${formatVolumeUsd(asset.volume24hUsd)} Vol`
                    : asset.name}
              </span>
              {asset.listedAt ? (
                <span className="text-muted">{tokenAge(asset.listedAt, now)}</span>
              ) : null}
            </>
          )}
        </div>
      </div>

      <Sparkline
        series={asset.series as number[]}
        positive={(asset.changePct ?? 0) >= 0}
        className="h-[28px] w-[52px] shrink-0"
      />

      {/*
        The right column shows the most meaningful number the app actually
        knows, and labels which one it is.

        Market cap is the right headline for a coin — it is what a launchpad
        feed is scanned for — but it needs a supply read, and until the indexer
        does one, `marketCapUsd` is null. Printing "— MC" on every row would be
        technically honest and completely useless, so the row falls back to the
        price and drops the MC label with it. The label is never shown over a
        number that is not a market cap.
      */}
      <div className="flex shrink-0 flex-col items-end gap-[3px] text-right">
        {!stock && isPriced(asset.marketCapUsd) ? (
          <>
            <span className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
              {formatMarketCapUsd(asset.marketCapUsd)}
              <span className="ml-1 text-[11px] font-bold text-faint">MC</span>
            </span>
            <Change pct={asset.changePct} />
          </>
        ) : (
          <>
            <span className="tabular-nums text-[15px] font-extrabold tracking-[-0.02em]">
              {formatPriceUsd(shownPrice)}
            </span>
            <Change pct={asset.changePct} />
          </>
        )}
      </div>
    </Link>
  );
}

/**
 * The change line, or a dash.
 *
 * A dash rather than `0.00%`, because an unknown change and a flat one are
 * different facts and only one of them is worth colouring green.
 */
function Change({pct}: {pct: number | null}) {
  if (pct === null || !Number.isFinite(pct)) {
    return <span className="tabular-nums text-[12.5px] font-bold text-faint">—</span>;
  }
  return <PriceDelta value={pct} className="text-[12.5px] font-bold" />;
}

/**
 * A fluid list of rows — no boxes, no rules, just the tickers.
 */
export function AssetList({
  assets,
  arrivals,
  now,
}: {
  assets: readonly Asset[];
  /** Row ids that were not in the previous update, so they slide in. */
  arrivals?: ReadonlySet<string>;
  now?: number;
}) {
  return (
    <ul className="-mx-[22px]">
      {assets.map((asset) => {
        const key = `${asset.kind}:${asset.id}`;
        return (
          <li key={key}>
            <AssetRow asset={asset} fresh={arrivals?.has(key)} now={now} />
          </li>
        );
      })}
    </ul>
  );
}
