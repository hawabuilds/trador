import Link from "next/link";

import {cn} from "@/lib/cn";
import {
  formatCompactUsd,
  formatPriceUsd,
  formatUtc,
  isPriced,
  tokenAge,
} from "@/lib/priceFormat";
import {LAUNCHPADS} from "@/lib/programs";
import {shortPubkey} from "@/lib/pubkey";
import {SECTOR_LABEL} from "@/lib/sectors";
import {ISSUERS} from "@/lib/stocks/registry";
import type {Asset, Stock, Stonk} from "@/lib/types";
import {Avatar} from "./ui/Avatar";
import {ChevronLeftIcon} from "./ui/Icons";
import {PairTicker, TypeBadge, VerifiedTick} from "./ui/Badges";
import {PriceDelta} from "./ui/PriceDelta";

/**
 * The asset page.
 *
 * One component for both sides of the universe, because the page is the same
 * shape for each: identity, the one number that matters, then the facts behind
 * it. What differs is which facts exist — a stock has an issuer and a
 * custodian, a coin has a launchpad and a creator — so the stat block is built
 * per kind rather than the whole page being forked.
 *
 * The chart, the trade tape and the order ticket land here next. Until they do,
 * the page says so rather than showing an empty frame where a chart will be.
 */
export function AssetPage({asset}: {asset: Asset}) {
  const stock = asset.kind === "stock";
  const symbol = stock ? asset.ticker : asset.symbol;

  return (
    <div className="pt-[calc(18px+env(safe-area-inset-top,0px))]">
      <Link
        href="/home"
        aria-label="Back"
        className="-ml-1.5 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <ChevronLeftIcon className="h-[20px] w-[20px]" />
      </Link>

      <header className="mt-3 flex items-start gap-3">
        {stock ? null : <Avatar name={symbol} seed={asset.mint} size={46} />}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h1 className="truncate text-[24px] font-extrabold tracking-[-0.03em] text-ink">
              {symbol}
            </h1>
            {stock ? <VerifiedTick /> : <PairTicker ticker={asset.quoteTicker} />}
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-muted">
            {asset.name}
          </p>
        </div>
      </header>

      <div className="mt-5">
        <div className="tabular-nums text-[34px] font-extrabold leading-none tracking-[-0.035em] text-ink">
          {formatPriceUsd(asset.price.usd)}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {asset.changePct === null ? (
            <span className="text-[13px] font-bold text-faint">
              No 24h change recorded
            </span>
          ) : (
            <>
              <PriceDelta value={asset.changePct} className="text-[14px] font-extrabold" />
              <span className="text-[12.5px] font-semibold text-faint">24h</span>
            </>
          )}
        </div>
      </div>

      {/*
        A placeholder that names what is missing rather than an empty chart
        frame. A blank panel reads as a failure; this reads as unfinished.
      */}
      <div className="mt-5 grid h-[150px] place-items-center rounded-[18px] bg-[var(--overlay-wash)]">
        <p className="px-8 text-center text-[12.5px] leading-[1.55] text-faint">
          Chart, trade tape and the order ticket are next.
        </p>
      </div>

      {stock ? <StockStats stock={asset} /> : <StonkStats stonk={asset} />}

      {asset.price.source === "snapshot" && asset.price.at ? (
        <p className="pt-6 text-center text-[11.5px] leading-[1.55] text-faint">
          Price captured {formatUtc(asset.price.at)}.
        </p>
      ) : null}
    </div>
  );
}

function StonkStats({stonk}: {stonk: Stonk}) {
  const launchpad = LAUNCHPADS[stonk.launchpad];

  return (
    <dl className="mt-6 divide-y divide-[var(--border-subtle)]">
      <Stat label="Market cap" value={formatMcap(stonk.marketCapUsd)} />
      <Stat
        label="Liquidity"
        value={
          stonk.liquidityUsd === null
            ? "Not measured"
            : formatCompactUsd(stonk.liquidityUsd)
        }
        /*
          A coin on a bonding curve has no pool, and the curve's seeded reserves
          are not liquidity. Unmeasured says so instead of printing a number
          that would be wrong by orders of magnitude.
        */
        hint={stonk.liquidityUsd === null ? "No pool measured yet" : undefined}
      />
      <Stat label="Priced in" value={stonk.quoteTicker} />
      <Stat
        label="Holder rewards"
        value={stonk.paysHolders ? `Paid in ${stonk.quoteTicker}` : "None"}
        hint={
          stonk.paysHolders
            ? "A share of every trade goes back to holders, in stock"
            : undefined
        }
      />
      <Stat label="Launchpad" value={launchpad.label} />
      <Stat label="Creator" value={shortPubkey(stonk.creator, 4, 4)} />
      <Stat label="Mint" value={shortPubkey(stonk.mint, 4, 4)} />
      {stonk.listedAt ? (
        <Stat label="Age" value={tokenAge(stonk.listedAt)} />
      ) : null}
    </dl>
  );
}

function StockStats({stock}: {stock: Stock}) {
  return (
    <dl className="mt-6 divide-y divide-[var(--border-subtle)]">
      <Stat
        label="Type"
        value={<TypeBadge kind={stock.stockKind} />}
      />
      <Stat label="Issuer" value={ISSUERS[stock.issuer].label} />
      {stock.sector ? (
        <Stat label="Sector" value={SECTOR_LABEL.get(stock.sector) ?? "—"} />
      ) : null}
      <Stat
        label="Coins priced in it"
        value={stock.launchesQuotedAgainst.toLocaleString("en-US")}
      />
      <Stat
        label="Underlying market cap"
        value={formatMcap(stock.marketCapUsd)}
        hint="The company's own market cap, not the token's"
      />
      {/*
        The honest note on a pre-IPO name: there is no listed equity, so no
        oracle and no exchange quote can be authoritative about its price. The
        only number available is what a pool says.
      */}
      <Stat
        label="Price source"
        value={stock.priceAuthority === "none" ? "Pool only" : "Oracle"}
        hint={
          stock.priceAuthority === "none"
            ? "Not publicly listed, so no exchange quote exists"
            : undefined
        }
      />
      <Stat label="Mint" value={shortPubkey(stock.mint, 4, 4)} />
    </dl>
  );
}

function formatMcap(value: number | null): string {
  return isPriced(value) ? formatCompactUsd(value) : "Not measured";
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[13px] font-semibold text-muted">
        {label}
        {hint ? (
          <span className="mt-0.5 block max-w-[22ch] text-[11.5px] font-medium leading-[1.45] text-faint">
            {hint}
          </span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "tabular-nums shrink-0 text-right text-[13.5px] font-extrabold text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
