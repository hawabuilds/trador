"use client";

import Link from "next/link";

import {CurveProgress} from "@/components/CurveProgress";
import {LaunchpadMark} from "@/components/LaunchpadMark";
import {Avatar} from "@/components/ui/Avatar";
import {PairTicker} from "@/components/ui/Badges";
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
 * So the right column is the progress bar and nothing else — the one figure
 * here that is read straight off chain.
 */
export function GraduatingList({coins}: {coins: readonly Stonk[]}) {
  return (
    <ul className="-mx-[22px]">
      {coins.map((coin) => (
        <li key={coin.mint}>
          <Link
            href={`/stonk/${coin.mint}`}
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
              </div>
            </div>

            <CurveProgress
              progress={coin.curveProgress}
              className="w-[108px] shrink-0"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
