"use client";

import {useInfiniteQuery} from "@tanstack/react-query";

import type {HistoryResponse, Position, TradeAssetLabel, WalletTrade} from "@/lib/walletTrades";

export const WALLET_TRADES_KEY = "wallet-trades";

/**
 * A wallet's trade history, optionally for one coin, paged newest first.
 *
 * The first page also carries cost basis per coin, which is what the
 * Stonkfolio's profit figures are worked out from.
 */
export function useWalletTrades(
  wallet: string | null,
  options: {mint?: string | null; enabled?: boolean} = {},
) {
  const mint = options.mint ?? null;
  const query = useInfiniteQuery({
    queryKey: [WALLET_TRADES_KEY, wallet, mint],
    enabled: (options.enabled ?? true) && wallet !== null,
    initialPageParam: null as string | null,
    queryFn: async ({pageParam}): Promise<HistoryResponse> => {
      const params = new URLSearchParams({wallet: wallet ?? ""});
      if (mint) params.set("mint", mint);
      if (pageParam) params.set("before", pageParam);
      const response = await fetch(`/api/stonkfolio/trades?${params}`);
      const body = (await response.json()) as HistoryResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not read your trades.");
      return body;
    },
    getNextPageParam: (last) => last.nextBefore,
    // Syncing parses new transactions, so it is not polled hard.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const pages = query.data?.pages ?? [];
  const trades: WalletTrade[] = pages.flatMap((page) => page.trades);
  const assets: Record<string, TradeAssetLabel> = Object.assign({}, ...pages.map((p) => p.assets));
  const positions: Position[] = pages[0]?.positions ?? [];

  return {
    trades,
    assets,
    positions,
    available: pages[0]?.available ?? true,
    notice: pages[0]?.error ?? null,
    isLoading: query.isLoading,
    error: (query.error as Error | null)?.message ?? null,
    hasMore: query.hasNextPage,
    loadMore: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
    retry: () => void query.refetch(),
  };
}
