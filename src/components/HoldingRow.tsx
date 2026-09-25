"use client";

import Link from "next/link";

import {assetHref} from "@/components/AssetRow";
import {Avatar} from "@/components/ui/Avatar";
import {PairTicker, VerifiedTick} from "@/components/ui/Badges";
import {usePrefetchAssetPage} from "@/hooks/useAsset";
import {cn} from "@/lib/cn";
import {compactMoney, units} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import type {Holding} from "@/lib/types";
import {holdingProfit, signedMoney, type Position} from "@/lib/walletTrades";

/**
 * One holding: what it is, how much, what it is worth, and the gain on it.
 *
 * Shared by your own Stonkfolio and everyone else's profile, so a holding reads
 * the same wherever it is shown.
 */
export function HoldingRow({
  holding,
  position,
  compact = false,
}: {
  holding: Holding;
  position?: Position;
  /** Tighter Stonkfolio list — 36px avatar, no vertical padding (gap lives on the parent). */
  compact?: boolean;
}) {
  const {asset} = holding;
  const stock = asset.kind === "stock";
  const symbol = stock ? asset.ticker : asset.symbol;
  const profit = holdingProfit(holding.amount, holding.valueUsd, position);
  const prefetchPage = usePrefetchAssetPage(asset);

  return (
    <Link
      href={assetHref(asset)}
      {...prefetchPage}
      className={cn(
        "flex px-[22px] transition-colors hover:bg-[var(--overlay-wash)]",
        compact ? "items-start gap-3 py-0" : "items-center gap-3 py-[13px]",
      )}
    >
      {stock ? null : (
        // The feed row passes the art and this row didn't, so a coin showed
        // its picture everywhere except the screen listing what you own.
        <Avatar name={symbol} src={asset.imageUrl} seed={asset.mint} size={compact ? 36 : 40} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate font-extrabold tracking-[-0.015em]",
              compact ? "text-[14px]" : "text-[15px]",
            )}
          >
            {symbol}
          </span>
          {stock ? <VerifiedTick size={14} /> : <PairTicker ticker={asset.quoteTicker} />}
        </div>
        <div
          className={cn(
            "tabular-nums mt-[3px] truncate font-semibold text-faint",
            compact ? "text-[11px]" : "text-[12.5px]",
          )}
        >
          {units(holding.amount)} {symbol} · {formatPriceUsd(asset.price.usd)}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            "tabular-nums text-[15px] font-extrabold tracking-[-0.02em]",
            holding.valueUsd === null && "text-faint",
          )}
        >
          {/* Unpriced says so. It is not worth zero. */}
          {holding.valueUsd === null ? "Unpriced" : compactMoney(holding.valueUsd)}
        </div>
        {profit ? (
          <div
            title={
              profit.partial
                ? "Covers only the part of this holding with a known purchase price."
                : "Current value minus what you paid."
            }
            className={cn(
              "tabular-nums mt-[3px] font-bold",
              compact ? "text-[11px]" : "text-[12.5px]",
              profit.usd >= 0 ? "text-price-up" : "text-price-down",
            )}
          >
            {signedMoney(profit.usd)}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
