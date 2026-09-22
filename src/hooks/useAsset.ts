"use client";

import {useRef} from "react";
import {useQuery, useQueryClient, type QueryClient} from "@tanstack/react-query";

import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import type {Asset, AssetKind, ChartPoint, NewsItem, Timeframe, Trade} from "@/lib/types";

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {error?: string} | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

type AssetResponse = {asset: Asset; stale: boolean};
type ChartResponse = {points: ChartPoint[]; timeframe: Timeframe; stale: boolean; error: string | null};
type TradesResponse = {
  trades: Trade[];
  pollMs: number;
  /** `chain` is every fill; `provider` may be partial. */
  source?: "chain" | "provider";
  stale: boolean;
  error: string | null;
};

/*
 * The three requests behind a coin page, defined once so the page and the feed
 * row that prefetches them share a cache key. A key that differed by one
 * character would make the prefetch a wasted call.
 */
const assetQuery = (kind: string, id: string) => ({
  queryKey: ["asset", kind, id],
  queryFn: () => get<AssetResponse>(`/api/asset/${kind}/${id}`),
});

const chartQuery = (kind: string, id: string, timeframe: Timeframe) => ({
  queryKey: ["chart", kind, id, timeframe],
  queryFn: () => get<ChartResponse>(`/api/asset/${kind}/${id}/chart?tf=${timeframe}`),
});

const tradesQuery = (kind: string, id: string) => ({
  queryKey: ["trades", kind, id],
  queryFn: () => get<TradesResponse>(`/api/asset/${kind}/${id}/trades`),
});

/**
 * Start loading a coin page before it is opened.
 *
 * Called when a finger or pointer lands on a feed row, which is a few hundred
 * milliseconds before the tap completes and the page mounts. The row already
 * holds the asset, so the header is seeded from it and needs no request at
 * all; the chart is asked for at the timeframe the page will pick, so it is
 * the same query rather than a near miss.
 */
export function prefetchAssetPage(client: QueryClient, asset: Asset): void {
  const kind: AssetKind = asset.kind;
  const id = asset.id;

  const seeded = assetQuery(kind, id).queryKey;
  if (!client.getQueryData(seeded)) {
    // Marked old, so the page still refreshes it once mounted.
    client.setQueryData<AssetResponse>(seeded, {asset, stale: false}, {updatedAt: 0});
  }

  const listedAt = asset.kind === "stonk" ? asset.listedAt : null;
  const timeframe = defaultChartTimeframe({kind, listedAt});
  void client.prefetchQuery(chartQuery(kind, id, timeframe));
  void client.prefetchQuery(tradesQuery(kind, id));
}

/**
 * Pointer, touch and focus handlers that prefetch a row's coin page. Once per
 * row per mount: after the first, the page's own polling takes over.
 */
export function usePrefetchAssetPage(asset: Asset) {
  const client = useQueryClient();
  const done = useRef(false);
  const start = () => {
    if (done.current) return;
    done.current = true;
    prefetchAssetPage(client, asset);
  };
  return {onPointerEnter: start, onTouchStart: start, onFocus: start};
}

export function useAsset(kind: string, id: string) {
  const query = useQuery({
    ...assetQuery(kind, id),
    refetchInterval: 15_000,
  });

  return {
    asset: query.data?.asset ?? null,
    stale: query.data?.stale ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}

export function useChart(kind: string, id: string, timeframe: Timeframe) {
  const query = useQuery({
    ...chartQuery(kind, id, timeframe),
    refetchInterval: 30_000,
    // Keep the previous series on screen while a new timeframe loads. Dropping
    // to an empty chart between two good states reads as a failure.
    placeholderData: (previous) => previous,
  });

  return {
    points: query.data?.points ?? [],
    resolvedTimeframe: query.data?.timeframe ?? timeframe,
    isLoading: query.isLoading,
    stale: query.data?.stale ?? false,
    error: query.data?.error ?? (query.error as Error | null)?.message ?? null,
    retry: () => void query.refetch(),
  };
}

export function useTrades(kind: string, id: string, enabled = true) {
  const query = useQuery({
    ...tradesQuery(kind, id),
    enabled,
    // The server decides the cadence, because it knows whether a provider key
    // is configured and therefore what the rate limit allows.
    refetchInterval: (query) => query.state.data?.pollMs ?? 12_000,
  });

  return {
    trades: query.data?.trades ?? [],
    complete: query.data?.source === "chain",
    isLoading: query.isLoading,
    error: query.data?.error ?? (query.error as Error | null)?.message ?? null,
    retry: () => void query.refetch(),
  };
}

export function useNews(id: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["asset-news", id],
    queryFn: () => get<{items: NewsItem[]; seeded: boolean}>(`/api/news?ticker=${id}`),
    enabled,
  });

  return {
    items: query.data?.items ?? [],
    seeded: query.data?.seeded ?? false,
    isLoading: query.isLoading,
    error: (query.error as Error | null)?.message ?? null,
    retry: () => void query.refetch(),
  };
}
