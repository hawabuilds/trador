"use client";

import Link from "next/link";

import {assetHref} from "@/components/AssetRow";
import {Avatar} from "@/components/ui/Avatar";
import {PairTicker, VerifiedTick} from "@/components/ui/Badges";
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
export function HoldingRow({holding, position}: {holding: Holding; position?: Position}) {
  const {asset} = holding;
  const stock = asset.kind === "stock";
  const symbol = stock ? asset.ticker : asset.symbol;
  const profit = holdingProfit(holding.amount, holding.valueUsd, position);

  return (
    <Link
      href={assetHref(asset)}
      className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
    >
      {stock ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-[12px] font-extrabold text-muted">
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        // The feed row passes the art and this row didn't, so a coin showed
        // its picture everywhere except the screen listing what you own.
        <Avatar name={symbol} src={asset.imageUrl} seed={asset.mint} size={40} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
            {symbol}
          </span>
          {stock ? <VerifiedTick size={14} /> : <PairTicker ticker={asset.quoteTicker} />}
        </div>
        <div className="tabular-nums mt-[3px] text-[12.5px] font-semibold text-faint">
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
        {/*
          Profit on what is held: worth now minus what it cost. Only shown
          when the trade history covers the purchase. A leading ~ means part of
          the holding arrived without a known price (a transfer, an airdrop, a
          token-for-token swap), so the figure covers only the bought part.
        */}
        {profit ? (
          <div
            title={
              profit.partial
                ? "Covers only the part of this holding with a known purchase price."
                : "Current value minus what you paid."
            }
            className={cn(
              "tabular-nums mt-[3px] text-[12.5px] font-bold",
              profit.usd >= 0 ? "text-price-up" : "text-price-down",
            )}
          >
            {profit.partial ? "~" : ""}
            {signedMoney(profit.usd)}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
