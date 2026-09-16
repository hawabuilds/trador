"use client";

import Link from "next/link";

import {txUrl} from "@/config/explorer";
import {cn} from "@/lib/cn";
import {compactMoney, relativeTime, units} from "@/lib/format";
import type {TradeAssetLabel, WalletTrade} from "@/lib/walletTrades";
import {LoadMore} from "./LoadMore";
import {PanelError, PanelNote} from "./panels/TradesPanel";
import {Avatar} from "./ui/Avatar";
import {ArrowUpRightIcon} from "./ui/Icons";

/**
 * Your trades, across every coin, newest first.
 *
 * Every swap the wallet made counts, wherever it was placed. A row says what
 * moved, what it was paid with, what that was worth then, and links to the
 * transaction so any line can be checked against the chain.
 */
export function WalletTradeList({
  trades,
  assets,
  isLoading,
  error,
  notice,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
}: {
  trades: WalletTrade[];
  assets: Record<string, TradeAssetLabel>;
  isLoading: boolean;
  error: string | null;
  notice: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  if (isLoading && trades.length === 0) return <PanelNote>Reading your trades from the chain…</PanelNote>;
  if (error && trades.length === 0) return <PanelError message={error} onRetry={onRetry} />;
  if (trades.length === 0) {
    return <PanelNote>{notice ?? "No trades yet. Buy a coin and it shows up here."}</PanelNote>;
  }

  return (
    <div className="-mx-[22px]">
      <ul>
        {trades.map((trade) => (
          <li key={`${trade.signature}:${trade.mint}`}>
            <TradeRow
              trade={trade}
              asset={assets[trade.mint]}
              paid={assets[trade.paidMint]}
            />
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="px-[22px]">
          <LoadMore onLoad={onLoadMore} loading={loadingMore} label="Older trades" />
        </div>
      ) : null}
    </div>
  );
}

function TradeRow({
  trade,
  asset,
  paid,
}: {
  trade: WalletTrade;
  asset: TradeAssetLabel | undefined;
  paid: TradeAssetLabel | undefined;
}) {
  const buy = trade.side === "buy";
  const symbol = asset?.symbol ?? `${trade.mint.slice(0, 4)}…`;
  const paidSymbol = paid?.symbol ?? `${trade.paidMint.slice(0, 4)}…`;

  const identity = (
    <>
      {asset?.kind === "stock" ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-[12px] font-extrabold text-muted">
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <Avatar name={symbol} src={asset?.imageUrl} seed={trade.mint} size={40} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "text-[12.5px] font-extrabold",
              buy ? "text-price-up" : "text-price-down",
            )}
          >
            {buy ? "Buy" : "Sell"}
          </span>
          <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
            {symbol}
          </span>
        </div>
        <div className="tabular-nums mt-[3px] truncate text-[12.5px] font-semibold text-faint">
          {units(trade.amount)} {symbol} {buy ? "for" : "→"} {units(trade.paidAmount)} {paidSymbol}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]">
      {asset?.href ? (
        <Link href={asset.href} className="flex min-w-0 flex-1 items-center gap-3">
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{identity}</div>
      )}

      <div className="shrink-0 text-right">
        <div
          className={cn(
            "tabular-nums text-[15px] font-extrabold tracking-[-0.02em]",
            trade.valueUsd === null && "text-faint",
          )}
        >
          {/* Unpriced says so. A trade paid in something without a price then is not free. */}
          {trade.valueUsd === null ? "Unpriced" : compactMoney(trade.valueUsd)}
        </div>
        <a
          href={txUrl(trade.signature)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View transaction"
          className="mt-[3px] inline-flex items-center gap-1 text-[11.5px] font-semibold text-faint transition-colors hover:text-ink"
        >
          {relativeTime(trade.at)}
          <ArrowUpRightIcon className="h-[11px] w-[11px]" />
        </a>
      </div>
    </div>
  );
}
