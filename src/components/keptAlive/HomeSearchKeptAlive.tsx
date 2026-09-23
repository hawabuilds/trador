"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {usePathname, useSearchParams} from "next/navigation";

import {HomeFeed} from "@/app/(app)/home/HomeFeed";
import {SearchScreen} from "@/app/(app)/search/SearchScreen";
import type {Asset, FeedPage, Stonk, Stock} from "@/lib/types";

type HomeSeedProps = {
  stonks: FeedPage<Stonk>;
  stocks: FeedPage<Stock>;
  graduating: readonly Stonk[];
  initialStonkSort: "trending" | "new" | "marketCap";
  seedGraduating: boolean;
  now: number;
};

type KeptAliveState = {
  home: HomeSeedProps | null;
  setHome: (props: HomeSeedProps) => void;
  searchPreview: readonly Asset[] | null;
  setSearchPreview: (preview: readonly Asset[]) => void;
};

const KeptAliveContext = createContext<KeptAliveState | null>(null);

function useKeptAlive() {
  const ctx = useContext(KeptAliveContext);
  if (!ctx) throw new Error("KeptAliveProvider required");
  return ctx;
}

/**
 * Keeps Home and Search mounted while the user visits other tabs.
 *
 * Next.js parallel routes would be the idiomatic version, but they fight this
 * app's single scroll container and server-seeded first paint. Mounting the two
 * heaviest tabs here — hidden, not unmounted — preserves list scroll and query
 * cache on return without restructuring the route tree.
 */
export function KeptAliveProvider({children}: {children: ReactNode}) {
  const [home, setHome] = useState<HomeSeedProps | null>(null);
  const [searchPreview, setSearchPreview] = useState<readonly Asset[] | null>(null);

  const value = useMemo(
    () => ({
      home,
      setHome,
      searchPreview,
      setSearchPreview,
    }),
    [home, searchPreview],
  );

  return <KeptAliveContext.Provider value={value}>{children}</KeptAliveContext.Provider>;
}

/** Server page writes first-paint props into the kept-alive Home feed. */
export function HomeSeed(props: HomeSeedProps) {
  const {setHome} = useKeptAlive();
  useLayoutEffect(() => {
    setHome(props);
  }, [
    props.stonks,
    props.stocks,
    props.graduating,
    props.initialStonkSort,
    props.seedGraduating,
    props.now,
    setHome,
  ]);
  return null;
}

/** Server page writes the search preview rows into the kept-alive panel. */
export function SearchSeed({preview}: {preview: readonly Asset[]}) {
  const {setSearchPreview} = useKeptAlive();
  useLayoutEffect(() => {
    setSearchPreview(preview);
  }, [preview, setSearchPreview]);
  return null;
}

function readBootstrapStonkSort(raw: string | null): HomeSeedProps["initialStonkSort"] {
  if (raw === "new" || raw === "marketCap") return raw;
  return "trending";
}

export function HomeSearchKeptAlivePanels() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {home, setHome, searchPreview, setSearchPreview} = useKeptAlive();

  const onHome = pathname === "/home" || pathname.startsWith("/home/");
  const onSearch = pathname === "/search" || pathname.startsWith("/search/");

  /*
   * Cold navigation to Home or Search from another tab (no prior server seed).
   * Bootstrap endpoints match what the pages would have rendered.
   */
  useEffect(() => {
    if (onHome && !home) {
      let cancelled = false;
      (async () => {
        try {
          const initialStonkSort = readBootstrapStonkSort(searchParams.get("sort"));
          const response = await fetch(
            `/api/home/bootstrap?sort=${encodeURIComponent(initialStonkSort)}`,
          );
          if (!response.ok || cancelled) return;
          const body = (await response.json()) as {
            at: number;
            stonks: HomeSeedProps["stonks"];
          };
          setHome({
            stonks: body.stonks,
            stocks: {items: [], cursor: null, source: "snapshot", capturedAt: null},
            graduating: [],
            initialStonkSort,
            seedGraduating: false,
            now: body.at,
          });
        } catch {
          // The feed hook will still load via /api/feed once mounted.
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [onHome, home, setHome, searchParams]);

  useEffect(() => {
    if (onSearch && !searchPreview) {
      let cancelled = false;
      (async () => {
        try {
          const response = await fetch("/api/home/bootstrap");
          if (!response.ok || cancelled) return;
          const body = (await response.json()) as {stonks: {items: Stonk[]}};
          setSearchPreview(body.stonks.items.slice(0, 4));
        } catch {
          setSearchPreview([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [onSearch, searchPreview, setSearchPreview]);

  return (
    <>
      {onHome && !home ? (
        <div className="animate-pulse space-y-4" aria-busy aria-label="Loading home">
          <div className="h-8 w-40 rounded-md bg-surface-raised" />
          <div className="h-64 rounded-xl bg-surface-raised" />
        </div>
      ) : null}
      {home ? (
        <div className={onHome ? undefined : "hidden"} aria-hidden={!onHome}>
          <HomeFeed {...home} active={onHome} />
        </div>
      ) : null}
      {onSearch && !searchPreview ? (
        <div className="animate-pulse space-y-4" aria-busy aria-label="Loading search">
          <div className="h-10 rounded-full bg-surface-raised" />
          <div className="h-48 rounded-xl bg-surface-raised" />
        </div>
      ) : null}
      {searchPreview ? (
        <div className={onSearch ? undefined : "hidden"} aria-hidden={!onSearch}>
          <SearchScreen preview={searchPreview} />
        </div>
      ) : null}
    </>
  );
}
