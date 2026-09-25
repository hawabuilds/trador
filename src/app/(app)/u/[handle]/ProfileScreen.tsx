"use client";

import {useMemo, useRef, useState} from "react";
import {useRouter} from "next/navigation";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";

import {APP_SCROLL_PAD_TOP} from "@/components/AppShell";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {AllocationChart} from "@/components/AllocationChart";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {HoldingRow} from "@/components/HoldingRow";
import {useWalletTrades} from "@/hooks/useWalletTrades";
import {positionByMint} from "@/lib/walletTrades";
import {Avatar} from "@/components/ui/Avatar";
import {Button} from "@/components/ui/Button";
import {ChevronLeftIcon, UserIcon} from "@/components/ui/Icons";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {fromBaseUnits, lamportsFrom} from "@/lib/amounts";
import {compact, compactMoney} from "@/lib/format";
import {shortPubkey} from "@/lib/pubkey";
import type {Holding, Profile} from "@/lib/types";

interface ProfileResponse {
  profile: Profile;
  followers: Profile[];
  following: Profile[];
}

/**
 * Someone else's profile.
 *
 * Readable signed out, because a profile link shared into a group chat has to
 * open for whoever taps it. What changes when you are signed in is the Follow
 * button — `isFollowing` comes back null for a visitor, and the button is then
 * not rendered at all rather than being rendered and failing on tap.
 */
export function ProfileScreen({handle}: {handle: string}) {
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();

  const [connections, setConnections] = useState<"followers" | "following" | null>(
    null,
  );
  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);

  const query = useQuery({
    queryKey: ["profile", handle],
    queryFn: async (): Promise<ProfileResponse | null> => {
      const token = await session.getAccessToken();
      const response = await fetch(`/api/profile/${handle}`, {
        headers: token ? {authorization: `Bearer ${token}`} : {},
      });
      // A missing handle is an ordinary outcome, not an error worth a retry.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load this profile.");
      return (await response.json()) as ProfileResponse;
    },
  });

  const follow = useMutation({
    mutationFn: async (wantFollow: boolean) => {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in to follow people.");

      const response = await fetch("/api/follows", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({handle, following: wantFollow}),
      });
      if (!response.ok) throw new Error("Could not update that follow.");
    },
    // Refetched rather than patched locally: the follower *count* moves too,
    // and a local toggle that updates the button but not the number beside it
    // is the kind of small lie people notice immediately.
    onSuccess: () => queryClient.invalidateQueries({queryKey: ["profile", handle]}),
  });

  const profile = query.data?.profile ?? null;
  const isSelf = session.user?.handle === profile?.handle;

  return (
    <div className={APP_SCROLL_PAD_TOP}>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Back"
        className="-ml-2 grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
      >
        <ChevronLeftIcon className="h-5 w-5" />
      </button>

      {query.isLoading ? (
        <div className="mt-4 flex items-center gap-3">
          <div className="h-14 w-14 animate-pulse rounded-full bg-wash" />
          <div className="flex-1">
            <div className="h-4 w-32 animate-pulse rounded bg-wash" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-wash" />
          </div>
        </div>
      ) : !profile ? (
        <div className="px-6 py-16 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--overlay-wash)] text-faint">
            <UserIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[14px] font-bold">No account @{handle}</p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
            {query.error
              ? (query.error as Error).message
              : "Nobody has claimed this handle here yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-start gap-3">
            <Avatar name={profile.displayName} src={profile.pfpUrl} size={56} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[20px] font-extrabold tracking-[-0.03em]">
                {profile.displayName}
              </h1>
              <div className="truncate text-[13px] font-semibold text-faint">
                @{profile.handle}
              </div>
            </div>

            {/*
              Null means nobody is signed in, which is not the same as "not
              following" — so no button at all, rather than one that fails at
              the moment it is tapped.
            */}
            {!isSelf && profile.isFollowing !== null ? (
              <Button
                variant={profile.isFollowing ? "outline" : "primary"}
                size="sm"
                disabled={follow.isPending}
                onClick={() => follow.mutate(!profile.isFollowing)}
              >
                {profile.isFollowing ? "Following" : "Follow"}
              </Button>
            ) : null}
          </div>

          {profile.bio ? (
            <p className="mt-3 text-[13.5px] leading-[1.55] text-muted">
              {profile.bio}
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-4">
            <button
              ref={followersRef}
              type="button"
              onClick={() =>
                setConnections(connections === "followers" ? null : "followers")
              }
              className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
            >
              <span className="font-extrabold text-ink">
                {compact(profile.followers)}
              </span>{" "}
              followers
            </button>
            <button
              ref={followingRef}
              type="button"
              onClick={() =>
                setConnections(connections === "following" ? null : "following")
              }
              className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
            >
              <span className="font-extrabold text-ink">
                {compact(profile.following)}
              </span>{" "}
              following
            </button>
          </div>

          {profile.wallet ? (
            <PublicStonkfolio wallet={profile.wallet} handle={profile.handle} isSelf={isSelf} />
          ) : !profile.portfolioPublic ? (
            <p className="mt-5 rounded-2xl bg-[var(--segment-track)] px-3.5 py-3 text-[13px] leading-[1.5] text-muted shadow-inset-soft">
              @{profile.handle} keeps their Stonkfolio private.
            </p>
          ) : null}

          {follow.error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              {(follow.error as Error).message}
            </p>
          ) : null}

          <ConnectionsSheet
            open={connections === "followers"}
            anchorRef={followersRef}
            title="Followers"
            people={query.data?.followers ?? []}
            emptyLabel={`Nobody follows @${profile.handle} yet.`}
            onClose={() => setConnections(null)}
          />
          <ConnectionsSheet
            open={connections === "following"}
            anchorRef={followingRef}
            title="Following"
            people={query.data?.following ?? []}
            emptyLabel={`@${profile.handle} is not following anyone yet.`}
            onClose={() => setConnections(null)}
          />
        </>
      )}
    </div>
  );
}

type Split = "all" | "stonk" | "stock";

const SPLITS: FilterOption<Split>[] = [
  {value: "all", label: "All"},
  {value: "stonk", label: "Stonks"},
  {value: "stock", label: "Stocks"},
];

interface StonkfolioResponse {
  holdings: Holding[];
  otherCount: number;
  solLamports: number;
  totalUsd: number;
  error?: string;
}

/**
 * Someone's Stonkfolio, on their profile — HODL's public holdings.
 *
 * Only rendered when the profile came back with a wallet, which the server
 * withholds for anyone who opted out (their own view excepted). The numbers are
 * the same reads as your own Stonkfolio: value from the chain, gains from the
 * wallet's own trade history.
 */
type ChartMode = "list" | "pie";

const CHART_MODES: FilterOption<ChartMode>[] = [
  {value: "list", label: "List"},
  {value: "pie", label: "Pie"},
];

function PublicStonkfolio({wallet, handle, isSelf}: {wallet: string; handle: string; isSelf: boolean}) {
  const [split, setSplit] = useState<Split>("all");
  const [chartMode, setChartMode] = useState<ChartMode>("list");

  const query = useQuery({
    queryKey: ["stonkfolio", wallet],
    queryFn: async (): Promise<StonkfolioResponse> => {
      const response = await fetch(`/api/stonkfolio?wallet=${wallet}`);
      const body = (await response.json()) as StonkfolioResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not read this Stonkfolio.");
      return body;
    },
    refetchInterval: 20_000,
  });

  const trades = useWalletTrades(wallet);
  const positions = useMemo(
    () => new Map(trades.positions.map((position) => [position.mint, position])),
    [trades.positions],
  );

  const holdings = useMemo(() => {
    const all = query.data?.holdings ?? [];
    return split === "all" ? all : all.filter((row) => row.asset.kind === split);
  }, [query.data?.holdings, split]);

  const solLabel = fromBaseUnits(BigInt(lamportsFrom(query.data?.solLamports) ?? 0), 9);

  return (
    <section className="mt-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
        Stonkfolio value
      </div>
      <div className="tabular-nums mt-0.5 text-[30px] font-extrabold leading-none tracking-[-0.035em]">
        {query.isLoading ? "—" : compactMoney(query.data?.totalUsd ?? 0)}
      </div>
      <div className="tabular-nums mt-1.5 flex items-center gap-2 text-[12px] font-bold text-faint">
        <span>{solLabel} SOL</span>
        {query.data && query.data.otherCount > 0 ? (
          <span>· {query.data.otherCount} not priced here</span>
        ) : null}
        <span className="ml-auto font-mono font-semibold">{shortPubkey(wallet, 4, 4)}</span>
      </div>
      {isSelf ? (
        <p className="mt-1.5 text-[11.5px] leading-snug text-faint">
          Others see this. Hide it from the gear on your Stonkfolio.
        </p>
      ) : null}

      <div className="mt-4 space-y-2.5">
        <FilterRail label="Chart mode" options={CHART_MODES} value={chartMode} onChange={setChartMode} />
        {chartMode === "list" ? (
          <FilterRail label="Split holdings" options={SPLITS} value={split} onChange={setSplit} />
        ) : null}
      </div>

      {chartMode === "pie" ? (
        query.isLoading ? (
          <div className="mt-3 h-[168px] animate-pulse rounded-2xl bg-wash" />
        ) : (
          <AllocationChart holdings={query.data?.holdings ?? []} targets={{}} className="mt-3 -mx-[22px]" />
        )
      ) : query.isLoading ? (
        <ul>
          {Array.from({length: 3}).map((_unused, index) => (
            <li key={index} className="flex items-center gap-3 py-3.5">
              <div className="h-10 w-10 animate-pulse rounded-full bg-wash" />
              <div className="flex-1">
                <div className="h-3.5 w-20 animate-pulse rounded bg-wash" />
                <div className="mt-2 h-3 w-14 animate-pulse rounded bg-wash" />
              </div>
            </li>
          ))}
        </ul>
      ) : query.error ? (
        <p className="py-8 text-center text-[13px] text-muted">{(query.error as Error).message}</p>
      ) : holdings.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">
          {split === "stock"
            ? `@${handle} holds no tokenized stocks.`
            : split === "stonk"
              ? `@${handle} holds no stonks.`
              : `@${handle} holds nothing Trador can price yet.`}
        </p>
      ) : (
        <ul className="-mx-[22px]">
          {holdings.map((holding) => (
            <li key={`${holding.asset.kind}:${holding.asset.id}`}>
              <HoldingRow
                holding={holding}
                position={positionByMint(positions, holding.asset.mint)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
