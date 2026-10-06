"use client";

import Link from "next/link";

import {Avatar} from "@/components/ui/Avatar";
import {cn} from "@/lib/cn";
import {compactMoney} from "@/lib/format";
import {tokenAge} from "@/lib/priceFormat";
import {assetPath} from "@/lib/routes";
import type {FeedTrade} from "@/lib/server/socialFeed";

/**
 * A buy or a sell by someone you follow.
 *
 * Lighter than a comment on purpose: no box, no button, one line of what
 * happened and one of where it stood. The whole row opens the coin, because
 * that is the only thing anyone wants after reading it.
 *
 * No amounts, ever. "Bought at $40M market cap" says everything a follower
 * needs; what they spent is theirs.
 */
export function FeedTradeRow({trade, now}: {trade: FeedTrade; now?: number}) {
  const {asset, actor} = trade;
  const bought = trade.side === "buy";

  return (
    <Link
      href={assetPath(asset.kind, asset.id)}
      className="flex items-start gap-3 py-3.5 transition-colors hover:bg-[var(--overlay-wash)]"
    >
      <Avatar name={actor.displayName} src={actor.pfpUrl} seed={actor.handle} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {/*
            The coin never truncates: it is the point of the row. A long handle
            gives way instead, which is the part a reader can live without.
          */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] text-ink">
            <span className="truncate font-semibold">{actor.handle}</span>
            <span
              className={cn(
                "shrink-0 font-medium",
                bought ? "text-price-up" : "text-price-down",
              )}
            >
              {bought ? "bought" : "sold"}
            </span>
            {asset.imageUrl ? (
              <Avatar
                name={asset.symbol}
                src={asset.imageUrl}
                seed={asset.id}
                size={24}
                className="shrink-0"
              />
            ) : null}
            <span className="shrink-0 font-semibold">{asset.symbol}</span>
          </span>
          <span className="shrink-0 text-[13px] text-faint">
            {tokenAge(trade.createdAt, now)}
          </span>
        </div>

        {detail(trade) ? (
          <p className="mt-0.5 text-[13px] text-faint">{detail(trade)}</p>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * The second line: where a buy stood, or how a sell went.
 *
 * Null rather than filler when neither can be said — an unpriced trade has no
 * market cap and an unpriced history has no result, and inventing one would be
 * the only dishonest thing on the row.
 */
function detail(trade: FeedTrade): string | null {
  if (trade.side === "buy") {
    return trade.marketCapUsd ? `at ${compactMoney(trade.marketCapUsd)} market cap` : null;
  }
  if (trade.outcome === "profit") return "in profit";
  if (trade.outcome === "loss") return "at a loss";
  return null;
}
