"use client";

import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";

import {StickyPageHeader} from "@/components/AppShell";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {SearchBar} from "@/components/ui/SearchBar";
import {shortPubkey} from "@/lib/pubkey";
import type {Asset, Stock, Stonk} from "@/lib/types";

type Scope = "all" | "stonk" | "stock";

const SCOPES: FilterOption<Scope>[] = [
  {value: "all", label: "All"},
  {value: "stonk", label: "Stonks"},
  {value: "stock", label: "Stocks"},
];

interface SearchResponse {
  stonks: Stonk[];
  stocks: Stock[];
  /** A valid mint that resolved to nothing in the store. */
  pastedMint: string | null;
}

export function SearchScreen() {
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  // Debounced, so typing a 44-character mint does not fire 44 requests.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(raw.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [raw]);

  const search = useQuery({
    queryKey: ["search", query],
    enabled: query.length > 0,
    queryFn: async (): Promise<SearchResponse> => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error("Search failed.");
      return (await response.json()) as SearchResponse;
    },
    placeholderData: (previous) => previous,
  });

  const results = useMemo<readonly Asset[]>(() => {
    const stonks = search.data?.stonks ?? [];
    const stocks = search.data?.stocks ?? [];
    if (scope === "stonk") return stonks;
    if (scope === "stock") return stocks;
    // Stocks first when both match: a ticker query is far more often after the
    // stock than after a coin that happens to mention it.
    return [...stocks, ...stonks];
  }, [search.data, scope]);

  const pastedMint = search.data?.pastedMint ?? null;
  const searching = query.length > 0;

  return (
    <div>
      <StickyPageHeader>
        <h1 className="mb-3 text-[22px] font-extrabold tracking-[-0.035em]">Search</h1>
        <SearchBar
          value={raw}
          onChange={setRaw}
          placeholder="Symbol, name, or paste a mint"
          label="Search coins and stocks"
        />
        <div className="py-3.5">
          <FilterRail label="Scope" options={SCOPES} value={scope} onChange={setScope} />
        </div>
      </StickyPageHeader>

      {!searching ? (
        <Hint
          title="Search the universe"
          body="Every coin priced against a tokenized stock, and every stock they are priced in. Pasting a mint looks it up directly."
        />
      ) : pastedMint ? (
        /*
          A real address that is not in Trador. Saying so is the whole point:
          the alternative is an empty list that reads as "you typed it wrong".
        */
        <Hint
          title="Not in Trador"
          body={`${shortPubkey(pastedMint, 6, 6)} is a valid mint, but it is not a coin priced against a verified stock — so it is not in this universe.`}
        />
      ) : results.length > 0 ? (
        <AssetList assets={results} />
      ) : search.isFetching ? (
        <p className="py-10 text-center text-[13.5px] text-muted">Searching…</p>
      ) : (
        <Hint title="No matches" body={`Nothing here matches “${query}”.`} />
      )}
    </div>
  );
}

function Hint({title, body}: {title: string; body: string}) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-[14px] font-bold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.55] text-muted">
        {body}
      </p>
    </div>
  );
}
