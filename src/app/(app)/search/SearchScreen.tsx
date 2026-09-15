"use client";

import {useEffect, useMemo, useState} from "react";
import {useQuery} from "@tanstack/react-query";

import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {AssetList} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {SearchBar} from "@/components/ui/SearchBar";
import {compact} from "@/lib/format";
import {profilePath} from "@/lib/routes";
import {shortPubkey} from "@/lib/pubkey";
import type {Asset, Profile, Stock, Stonk} from "@/lib/types";

type Scope = "all" | "stonk" | "stock" | "people";

const SCOPES: FilterOption<Scope>[] = [
  {value: "all", label: "All"},
  {value: "stonk", label: "Stonks"},
  {value: "stock", label: "Stocks"},
  {value: "people", label: "People"},
];

interface SearchResponse {
  stonks: Stonk[];
  stocks: Stock[];
  people: Profile[];
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
    if (scope === "people") return [];
    if (scope === "stonk") return stonks;
    if (scope === "stock") return stocks;
    // Stocks first when both match: a ticker query is far more often after the
    // stock than after a coin that happens to mention it.
    return [...stocks, ...stonks];
  }, [search.data, scope]);

  /*
   * People are a separate list rather than more `AssetList` rows.
   *
   * An account is not an asset — it has no price, no chart and no market cap,
   * so squeezing one into a row built around those would mean four empty
   * columns and a dash where the number goes.
   */
  const people = useMemo<Profile[]>(() => {
    if (scope === "stonk" || scope === "stock") return [];
    return search.data?.people ?? [];
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
          placeholder="Coin, stock, @handle, or paste a mint"
          label="Search coins, stocks and people"
        />
        <div className="py-3.5">
          <FilterRail label="Scope" options={SCOPES} value={scope} onChange={setScope} />
        </div>
      </StickyPageHeader>

      {!searching ? (
        <Hint
          title="Search the universe"
          body="Every coin priced against a tokenized stock, every stock they are priced in, and everyone trading them. Pasting a mint looks it up directly."
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
      ) : results.length > 0 || people.length > 0 ? (
        <>
          {people.length > 0 ? (
            <section className={results.length > 0 ? "mb-5" : undefined}>
              {results.length > 0 ? (
                <h2 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
                  People
                </h2>
              ) : null}
              <ul className="-mx-[22px]">
                {people.map((person) => (
                  <li key={person.id}>
                    <PersonRow person={person} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.length > 0 ? (
            <section>
              {people.length > 0 ? (
                <h2 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
                  Markets
                </h2>
              ) : null}
              <AssetList assets={results} />
            </section>
          ) : null}
        </>
      ) : search.isFetching ? (
        <p className="py-10 text-center text-[13.5px] text-muted">Searching…</p>
      ) : (
        <Hint title="No matches" body={`Nothing here matches “${query}”.`} />
      )}
    </div>
  );
}

/** One account in the results. Links to their profile. */
function PersonRow({person}: {person: Profile}) {
  return (
    <Link
      href={profilePath(person.handle)}
      className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
    >
      <Avatar name={person.displayName} src={person.pfpUrl} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
          {person.displayName}
        </div>
        <div className="truncate text-[12.5px] font-semibold text-faint">
          @{person.handle} · {compact(person.followers)} followers
        </div>
      </div>
    </Link>
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
