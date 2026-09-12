"use client";

import {useQuery} from "@tanstack/react-query";

import type {Asset, ChartPoint, NewsItem, Timeframe, Trade} from "@/lib/types";

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {error?: string} | null;
    throw new Error(body?.error ?? `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export function useAsset(kind: string, id: string) {
  const query = useQuery({
    queryKey: ["asset", kind, id],
    queryFn: () => get<{asset: Asset; stale: boolean}>(`/api/asset/${kind}/${id}`),
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
    queryKey: ["chart", kind, id, timeframe],
    queryFn: () =>
      get<{points: ChartPoint[]; timeframe: Timeframe; stale: boolean; error: string | null}>(
        `/api/asset/${kind}/${id}/chart?tf=${timeframe}`,
      ),
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
    queryKey: ["trades", kind, id],
    queryFn: () =>
      get<{trades: Trade[]; pollMs: number; stale: boolean; error: string | null}>(
        `/api/asset/${kind}/${id}/trades`,
      ),
    enabled,
    // The server decides the cadence, because it knows whether a provider key
    // is configured and therefore what the rate limit allows.
    refetchInterval: (query) => query.state.data?.pollMs ?? 12_000,
  });

  return {
    trades: query.data?.trades ?? [],
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
