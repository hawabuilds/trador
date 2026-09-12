"use client";

import {useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";

import {StickyPageHeader} from "@/components/AppShell";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {relativeTime} from "@/lib/format";
import type {NewsItem} from "@/lib/types";

type Window = "latest" | "24h" | "7d" | "all";

const WINDOWS: FilterOption<Window>[] = [
  {value: "latest", label: "Latest"},
  {value: "24h", label: "24h"},
  {value: "7d", label: "7d"},
  {value: "all", label: "All"},
];

const WINDOW_MS: Record<Window, number | null> = {
  latest: 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "7d": 7 * 86_400_000,
  all: null,
};

interface WireResponse {
  items: NewsItem[];
  tickers: string[];
}

/**
 * The news tab.
 *
 * Coverage of the companies behind the stocks this app's coins are priced
 * against — not crypto news. A coin quoted in NVDAx moves partly because
 * Nvidia moved, and that is the headline worth reading next to the chart.
 */
export function NewsScreen() {
  const [window, setWindow] = useState<Window>("latest");
  const [ticker, setTicker] = useState<string>("all");

  const wire = useQuery({
    queryKey: ["news-wire"],
    queryFn: async (): Promise<WireResponse> => {
      const response = await fetch("/api/news");
      if (!response.ok) throw new Error("Could not load the wire.");
      return (await response.json()) as WireResponse;
    },
    staleTime: 300_000,
  });

  const tickerOptions = useMemo<FilterOption<string>[]>(
    () => [
      {value: "all", label: "All"},
      ...(wire.data?.tickers ?? []).map((value) => ({value, label: value})),
    ],
    [wire.data?.tickers],
  );

  const items = useMemo(() => {
    const all = wire.data?.items ?? [];
    const span = WINDOW_MS[window];
    const cutoff = span === null ? 0 : Date.now() - span;

    return all.filter((item) => {
      if (ticker !== "all" && item.source !== underlying(ticker)) return false;
      return span === null || Date.parse(item.publishedAt) >= cutoff;
    });
  }, [wire.data?.items, window, ticker]);

  return (
    <div>
      <StickyPageHeader>
        <h1 className="text-[22px] font-extrabold tracking-[-0.035em]">News</h1>
        <p className="mt-0.5 text-[12.5px] font-medium text-faint">
          The companies behind the stocks people are trading against
        </p>
        <div className="flex flex-col gap-2.5 py-3.5">
          <FilterRail label="Window" options={WINDOWS} value={window} onChange={setWindow} />
          <FilterRail
            label="Filter by stock"
            options={tickerOptions}
            value={ticker}
            onChange={setTicker}
          />
        </div>
      </StickyPageHeader>

      {wire.isLoading ? (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {Array.from({length: 6}).map((_unused, index) => (
            <li key={index} className="py-3.5">
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-wash" />
              <div className="mt-2 h-3 w-24 animate-pulse rounded bg-wash" />
            </li>
          ))}
        </ul>
      ) : wire.error ? (
        <p className="py-10 text-center text-[13.5px] text-muted">
          Could not load the wire. It will retry.
        </p>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-[13.5px] text-muted">
          Nothing published in this window.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="-mx-[22px] block px-[22px] py-3.5 transition-colors hover:bg-[var(--overlay-wash)]"
              >
                <div className="text-[13.5px] font-semibold leading-[1.4] tracking-[-0.01em]">
                  {item.title}
                </div>
                {item.summary ? (
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-[1.45] text-muted">
                    {item.summary}
                  </p>
                ) : null}
                <div className="mt-1.5 flex items-center gap-2 text-[11.5px] font-bold text-faint">
                  <span className="rounded-[6px] bg-[var(--overlay-wash)] px-1.5 py-[2px]">
                    {item.source}
                  </span>
                  <span>{relativeTime(item.publishedAt)}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The wire tags each item with the underlying ticker it was fetched for, while
 * the chips show the tokenized ticker people recognise — so `NVDAx` has to map
 * back to `NVDA` to filter.
 */
function underlying(tokenized: string): string {
  if (tokenized === "BRK.Bx") return "BRK-B";
  return tokenized.endsWith("x") ? tokenized.slice(0, -1) : tokenized;
}
