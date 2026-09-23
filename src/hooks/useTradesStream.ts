"use client";

import {useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";

import {TRADES_SSE} from "@/config/flags";
import type {TradesResponse} from "@/lib/types";

/**
 * When enabled, keeps the trades query warm from SSE and disables interval poll.
 */
export function useTradesStream(kind: string, id: string, enabled: boolean): boolean {
  const client = useQueryClient();
  const [active, setActive] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!TRADES_SSE || !enabled) {
      setActive(false);
      return;
    }

    const key = ["trades", kind, id];
    const url = `/api/asset/${kind}/${id}/trades/stream`;
    const source = new EventSource(url);
    sourceRef.current = source;
    setActive(true);

    source.onmessage = (event) => {
      try {
        const body = JSON.parse(event.data) as Omit<TradesResponse, "stale"> & {
          stale?: boolean;
        };
        client.setQueryData<TradesResponse>(key, {
          trades: body.trades,
          pollMs: body.pollMs,
          source: body.source,
          tapeComplete: body.tapeComplete,
          stale: body.stale ?? false,
          error: body.error ?? null,
        });
      } catch {
        // Malformed event — wait for the next tick.
      }
    };

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      setActive(false);
    };

    return () => {
      source.close();
      sourceRef.current = null;
      setActive(false);
    };
  }, [kind, id, enabled, client]);

  return active;
}
