"use client";

import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";

import type {AssetPageInitial} from "@/lib/types";

/**
 * Streams chart/trades seeds into React Query after the header has painted.
 * The coin page reads the same keys as SSR would have seeded in one block.
 */
export function CoinSecondaryHydration({initial}: {initial: AssetPageInitial}) {
  const client = useQueryClient();
  useState(() => {
    const at = initial.at;
    const asset = initial.asset?.asset;
    if (!asset) return;
    const kind = asset.kind;
    const id = asset.id;
    if (initial.chart) {
      client.setQueryData(
        ["chart", kind, id, initial.chart.timeframe],
        initial.chart,
        {updatedAt: at},
      );
    }
    if (initial.trades) {
      client.setQueryData(["trades", kind, id], initial.trades, {updatedAt: at});
    }
  });
  return null;
}
