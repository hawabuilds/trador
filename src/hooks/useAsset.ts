"use client";

import {useRef, useState} from "react";
import {keepPreviousData, useQuery, useQueryClient, type QueryClient} from "@tanstack/react-query";

import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {useTradesStream} from "@/hooks/useTradesStream";
import {preloadAssetPageCode} from "@/lib/preloadAssetPageCode";
import type {
  Asset,
  AssetKind,
  AssetResponse,
  ChartResponse,
  NewsItem,
  Timeframe,
  TradesResponse,
} from "@/lib/types";

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {error?: string} | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

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
  queryFn: () =>
    get<TradesResponse>(`/api/asset/${kind}/${id}/trades`, {cache: "no-store"}),
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
  preloadAssetPageCode();
  const kind: AssetKind = asset.kind;
  const id = asset.id;

  const seeded = assetQuery(kind, id).queryKey;
  if (!client.getQueryData(seeded)) {
    // Marked old, so the page still refreshes it once mounted.
    client.setQueryData<AssetResponse>(seeded, {asset, stale: false}, {updatedAt: 0});
  }

  const listedAt = asset.kind === "stonk" ? asset.listedAt : null;
  const timeframe = defaultChartTimeframe({kind, listedAt});
  void client.prefetchQuery({...chartQuery(kind, id, timeframe), staleTime: 15_000});
  void client.prefetchQuery({...tradesQuery(kind, id), staleTime: 0});
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

/**
 * Data the server rendered into the page, and when it read it. Used only when
 * the browser holds nothing for that query yet; `at` makes it count as old, so
 * it is shown at once and then refreshed rather than trusted for a full poll.
 */
export interface Seed<T> {
  data: T | null;
  at: number;
}

/**
 * Put a seed into the cache before the query first reads it — but only when it
 * is newer than what the cache holds. The cache may already have this coin
 * from a hovered row or from the device's saved copy, and the newer of the
 * two should win either way. Once, on the first render.
 */
function useSeed<T>(key: readonly unknown[], seed?: Seed<T>): void {
  const client = useQueryClient();
  useState(() => {
    if (!seed?.data) return;
    const held = client.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (seed.at > held) client.setQueryData(key, seed.data, {updatedAt: seed.at});
  });
}

export function useAsset(kind: string, id: string, seed?: Seed<AssetResponse>) {
  useSeed(assetQuery(kind, id).queryKey, seed);
  const query = useQuery({
    ...assetQuery(kind, id),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  return {
    asset: query.data?.asset ?? null,
    stale: query.data?.stale ?? false,
    isLoading: query.isLoading,
    error: query.error as Error | null,
  };
}

export function useChart(
  kind: string,
  id: string,
  timeframe: Timeframe,
  seed?: Seed<ChartResponse>,
) {
  // Only when the server read the timeframe this is asking for.
  useSeed(chartQuery(kind, id, timeframe).queryKey, seed?.data?.timeframe === timeframe ? seed : undefined);
  const query = useQuery({
    ...chartQuery(kind, id, timeframe),
    staleTime: 15_000,
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

export function useTrades(
  kind: string,
  id: string,
  enabled = true,
  seed?: Seed<TradesResponse>,
) {
  useSeed(tradesQuery(kind, id).queryKey, seed);
  const streaming = useTradesStream(kind, id, enabled);
  const query = useQuery({
    ...tradesQuery(kind, id),
    enabled,
    // Always stale so interval polls and remounts pick up new fills; pollMs
    // sets cadence, not whether the last response is trusted.
    staleTime: 0,
    placeholderData: keepPreviousData,
    // The server decides the cadence, because it knows whether a provider key
    // is configured and therefore what the rate limit allows.
    refetchInterval: streaming
      ? false
      : (query) => query.state.data?.pollMs ?? 12_000,
  });

  return {
    trades: query.data?.trades ?? [],
    complete:
      query.data?.source === "chain" && query.data?.tapeComplete !== false,
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
