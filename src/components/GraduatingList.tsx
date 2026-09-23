"use client";

import Link from "next/link";

import {CurveProgress} from "@/components/CurveProgress";
import {assetPath} from "@/lib/routes";
import {LaunchpadMark} from "@/components/LaunchpadMark";
import {Avatar} from "@/components/ui/Avatar";
import {PairTicker} from "@/components/ui/Badges";
import {formatMarketCapUsd, isPriced, tokenAge} from "@/lib/priceFormat";
import type {Stonk} from "@/lib/types";

/**
 * Launches still on their bonding curve, nearest to graduating first.
 *
 * A separate list rather than `AssetList`, because the shape of the row is
 * genuinely different. `AssetRow` ends in a market cap and a 24h change, and a
 * curve coin has neither: there is no pool, so there is no price this app will
 * print, and the seeded virtual reserves that every provider reports as
 * "liquidity" are not liquidity. Reusing that row would mean four columns of
 * dashes and one number that looks like the others but is not.
 *
 * The right column is the progress bar and the market cap, and nothing else.
 *
 * The market cap is real. A bonding curve is a formula, so a coin on one has an
 * exact price — arguably a firmer number than a thin pool's last trade — and it
 * is stored with `price_source: "curve"` to say which it is. What is *not* real
 * is the liquidity a provider will happily report alongside it: that figure is
 * the curve's seeded virtual reserves, money nobody can trade against, and it
 * is discarded at the indexer rather than shown here.
 */
export function GraduatingList({
  coins,
  now,
}: {
  coins: readonly Stonk[];
  /** Passed in so age strings match on the server and after hydration. */
  now?: number;
}) {
  return (
    <ul className="-mx-[22px]">
      {coins.map((coin) => (
        <li key={coin.mint}>
          <Link
            href={assetPath("stonk", coin.mint, "1m")}
            prefetch={false}
            className="flex items-center gap-3 px-[22px] py-[13px] transition-colors duration-150 hover:bg-[var(--overlay-wash)]"
          >
            <Avatar
              name={coin.symbol}
              src={coin.imageUrl}
              seed={coin.mint}
              size={40}
            />

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
                  {coin.symbol || "Unnamed"}
                </span>
                <PairTicker ticker={coin.quoteTicker} />
              </div>
              <div className="mt-[3px] flex items-center gap-2 truncate text-[12.5px] font-semibold">
                <LaunchpadMark launchpad={coin.launchpad} size={14} />
                <span className="truncate text-faint">{coin.name}</span>
                {coin.listedAt ? (
                  <span className="text-muted">{tokenAge(coin.listedAt, now)}</span>
                ) : null}
              </div>
            </div>

            <div className="flex w-[104px] shrink-0 flex-col items-end gap-[5px]">
              <span className="tabular-nums text-[14px] font-extrabold tracking-[-0.02em]">
                {isPriced(coin.marketCapUsd) ? (
                  <>
                    {formatMarketCapUsd(coin.marketCapUsd)}
                    <span className="ml-1 text-[10.5px] font-bold text-faint">MC</span>
                  </>
                ) : (
                  // A dash, never $0. An unpriced curve is one the decorate
                  // pass has not reached, not one worth nothing.
                  <span className="text-faint">—</span>
                )}
              </span>
              <CurveProgress progress={coin.curveProgress} className="w-full" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
