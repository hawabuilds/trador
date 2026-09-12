"use client";

import {accountUrl, tokenUrl} from "@/config/explorer";
import {useLivePrice} from "@/hooks/useLivePrice";
import {cn} from "@/lib/cn";
import {ageSince, compact, percent, shortAddress, stamp} from "@/lib/format";
import {supplyOf} from "@/lib/marketCap";
import {
  formatLiquidityUsd,
  formatMarketCapAt,
  formatPriceUsd,
  formatVolumeUsd,
} from "@/lib/priceState";
import {LAUNCHPADS} from "@/lib/programs";
import type {Stonk} from "@/lib/types";
import {LaunchpadMark} from "../LaunchpadMark";
import {ArrowUpRightIcon} from "../ui/Icons";

/**
 * The stat block a coin trader reads before sizing: depth first, then supply,
 * then age. Market cap comes last because it is already at the top of the page.
 *
 * Every "unknown" here says so in words rather than printing a zero. On a
 * launchpad feed the difference matters constantly — a coin with no measured
 * pool and a coin with an empty pool look identical if both render "$0".
 */
export function InfoPanel({stonk}: {stonk: Stonk}) {
  // The same shared price and the same calculation as the header above it.
  // Two surfaces on one screen recomputing a cap independently is how they end
  // up disagreeing by double digits.
  const livePrice = useLivePrice(stonk.id);
  const shownPrice = livePrice ?? stonk.price.usd ?? 0;
  const supply = supplyOf(stonk);

  /**
   * Depth against daily flow — the one derived number worth the space.
   *
   * A large cap over a thin pool is exactly the failure this page should
   * expose, and the ratio says it faster than the two figures side by side.
   */
  const turnover =
    stonk.liquidityUsd && stonk.liquidityUsd > 0 && stonk.volume24hUsd && stonk.volume24hUsd > 0
      ? stonk.volume24hUsd / stonk.liquidityUsd
      : 0;

  const launchpad = LAUNCHPADS[stonk.launchpad];

  return (
    <div className="pb-1">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0 overflow-hidden rounded-2xl bg-surface-card shadow-card">
        <Stat label="Liquidity" value={formatLiquidityUsd(stonk.liquidityUsd)} />
        <Stat label="24h volume" value={formatVolumeUsd(stonk.volume24hUsd)} />
        <Stat label="Market cap" value={formatMarketCapAt(stonk, shownPrice)} />
        <Stat label="Price" value={formatPriceUsd(shownPrice)} />
        <Stat label="Supply" value={supply === null ? "—" : compact(supply)} />
        <Stat
          label="Priced in"
          value={stonk.quoteTicker}
        />
        <Stat
          label="Vol / liq"
          value={turnover > 0 ? `${turnover.toFixed(2)}x` : "—"}
        />
        <Stat
          label="24h change"
          value={stonk.changePct === null ? "—" : percent(stonk.changePct)}
          tone={
            stonk.changePct === null ? undefined : stonk.changePct >= 0 ? "up" : "down"
          }
        />
      </dl>

      <div className="mt-4 overflow-hidden rounded-2xl bg-surface-card shadow-card">
        <Row label="Pair">
          <span className="tabular-nums text-[13px] font-extrabold">
            {stonk.symbol} / {stonk.quoteTicker}
          </span>
        </Row>

        <Row label="Launchpad">
          <a
            href={launchpad.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[13px] font-extrabold transition-colors hover:text-price-up"
          >
            <LaunchpadMark launchpad={stonk.launchpad} size={20} />
            {launchpad.label}
            <ArrowUpRightIcon className="h-3.5 w-3.5 text-faint" />
          </a>
        </Row>

        <Row label="Holder rewards">
          {stonk.paysHolders ? (
            <span className="text-[13px] font-extrabold text-price-up">
              Paid in {stonk.quoteTicker}
            </span>
          ) : (
            // "None" is accurate here: the launch config decides this, and the
            // standard config does not route rewards.
            <span className="text-[13px] font-extrabold text-faint">None</span>
          )}
        </Row>

        <Row label="Tradeable">
          {stonk.isTradeable === null ? (
            // Not "no". Nothing has measured this pool yet, and saying no would
            // be a guess printed as a fact.
            <span className="text-[13px] font-extrabold text-faint">Not measured</span>
          ) : stonk.isTradeable ? (
            <span className="text-[13px] font-extrabold">Yes</span>
          ) : (
            <span className="text-[13px] font-extrabold text-faint">
              Below liquidity floor
            </span>
          )}
        </Row>

        <Row label="Mint">
          <a
            href={tokenUrl(stonk.mint)}
            target="_blank"
            rel="noopener noreferrer"
            className="tabular-nums flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            {shortAddress(stonk.mint)}
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </Row>

        <Row label="Pool">
          <a
            href={accountUrl(stonk.pool)}
            target="_blank"
            rel="noopener noreferrer"
            className="tabular-nums flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            {shortAddress(stonk.pool)}
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </Row>

        <Row label="Creator">
          <a
            href={accountUrl(stonk.creator)}
            target="_blank"
            rel="noopener noreferrer"
            className="tabular-nums flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-ink"
          >
            {shortAddress(stonk.creator)}
            <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </Row>

        {stonk.listedAt ? (
          <Row label="Launched">
            <span className="text-[13px] font-semibold text-muted">
              {stamp(stonk.listedAt)} · {ageSince(stonk.listedAt)} old
            </span>
          </Row>
        ) : null}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="px-4 py-3 [&:nth-child(odd)]:bg-[var(--overlay-wash)]/40">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums mt-0.5 text-[15px] font-extrabold tracking-[-0.02em]",
          tone === "up" && "text-price-up",
          tone === "down" && "text-price-down",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40">
      <span className="text-[12.5px] font-bold text-faint">{label}</span>
      {children}
    </div>
  );
}
