"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {StickyPageHeader} from "@/components/AppShell";
import type {BalancePoint} from "@/components/BalanceChart";
import {EditTargetsSheet} from "@/components/EditTargetsSheet";
import {ReceiveSheet} from "@/components/ReceiveSheet";
import {RebalanceSheet} from "@/components/RebalanceSheet";
import {SendSheet} from "@/components/SendSheet";
import {WalletActionsRow} from "@/components/WalletActionsRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {Button} from "@/components/ui/Button";
import {CopyIcon, WalletIcon} from "@/components/ui/Icons";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {SettingsMenu} from "@/components/SettingsMenu";
import {ShareProfileButton} from "@/components/ShareProfileButton";
import {SocialRow} from "@/components/SocialRow";
import {PriceDelta} from "@/components/ui/PriceDelta";
import {HoldingRow} from "@/components/HoldingRow";
import {useBalanceHistory, type BalanceRange} from "@/hooks/useBalanceHistory";
import {useMe} from "@/hooks/useMe";
import {usePageRefresh} from "@/hooks/usePageRefresh";
import {useUser} from "@/hooks/useUser";
import {useWalletTrades, WALLET_TRADES_KEY} from "@/hooks/useWalletTrades";
import {drift, rebalanceScore, targetsValid} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import {
  LOCAL_STORE_EVENT,
  readPieTargets,
  readSlippageBps,
  writePieTargets,
} from "@/lib/localStore";
import {fromBaseUnits, lamportsFrom} from "@/lib/amounts";
import {compact, compactMoney, stamp} from "@/lib/format";
import {shortPubkey} from "@/lib/pubkey";
import type {Holding} from "@/lib/types";

const AllocationChart = dynamic(
  () => import("@/components/AllocationChart").then((m) => ({default: m.AllocationChart})),
  {ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded-panel bg-wash" />},
);
const BalanceChart = dynamic(
  () => import("@/components/BalanceChart").then((m) => ({default: m.BalanceChart})),
  {ssr: false, loading: () => <div className="h-[180px] animate-pulse rounded-panel bg-wash" />},
);

type Split = "all" | "stonk" | "stock";

const SPLITS: FilterOption<Split>[] = [
  {value: "all", label: "All"},
  {value: "stonk", label: "Stonks"},
  {value: "stock", label: "Stocks"},
];

type ChartMode = "trend" | "pie";

const CHART_MODES: FilterOption<ChartMode>[] = [
  {value: "trend", label: "Trend"},
  {value: "pie", label: "Pie"},
];

const REBALANCE_THRESHOLD = 2;

interface StonkfolioResponse {
  holdings: Holding[];
  otherCount: number;
  solLamports: number;
  totalUsd: number;
  stale: boolean;
  error?: string;
}

/**
 * Your holdings.
 *
 * Read from the chain rather than from a stored book, so it is the same number
 * a block explorer would give. Two honesty rules it follows throughout:
 * a holding with no price contributes nothing to the total rather than zero,
 * and tokens outside Trador's universe are counted and named rather than
 * silently dropped — otherwise the total would quietly disagree with reality.
 */
export function StonkfolioScreen() {
  const {authenticated, wallet, displayName, handle, pfpUrl, isDemo, login} = useUser();
  const [split, setSplit] = useState<Split>("all");
  const [copied, setCopied] = useState(false);
  const [range, setRange] = useState<BalanceRange>("1w");
  const [scrubbed, setScrubbed] = useState<BalancePoint | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>("trend");
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [editTargetsOpen, setEditTargetsOpen] = useState(false);
  const [rebalanceOpen, setRebalanceOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [connections, setConnections] = useState<"followers" | "following" | null>(null);

  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);

  const me = useMe();
  const queryClient = useQueryClient();

  usePageRefresh(
    "stonkfolio",
    useCallback(async () => {
      if (wallet) {
        try {
          const response = await fetch(
            `/api/stonkfolio?wallet=${encodeURIComponent(wallet)}&refresh=1`,
            {cache: "no-store"},
          );
          if (response.ok) {
            const body = (await response.json()) as StonkfolioResponse;
            queryClient.setQueryData(["stonkfolio", wallet], body);
          } else {
            await queryClient.refetchQueries({queryKey: ["stonkfolio", wallet]});
          }
        } catch {
          await queryClient.refetchQueries({queryKey: ["stonkfolio", wallet]});
        }
      }
      await Promise.all([
        wallet
          ? queryClient.refetchQueries({
              predicate: (query) =>
                query.queryKey[0] === "stonkfolio-history" && query.queryKey[1] === wallet,
            })
          : Promise.resolve(),
        wallet
          ? queryClient.refetchQueries({queryKey: [WALLET_TRADES_KEY, wallet]})
          : Promise.resolve(),
        handle ? queryClient.refetchQueries({queryKey: ["profile", handle]}) : Promise.resolve(),
      ]);
    }, [queryClient, wallet, handle]),
  );

  const query = useQuery({
    queryKey: ["stonkfolio", wallet],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<StonkfolioResponse> => {
      const response = await fetch(`/api/stonkfolio?wallet=${wallet}`);
      const body = (await response.json()) as StonkfolioResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not read your wallet.");
      return body;
    },
    // Matches the server-side holdings cache and private browser cache.
    refetchInterval: 12_000,
    refetchOnWindowFocus: false,
  });

  const history = useBalanceHistory(wallet, range, query.data?.totalUsd ?? null);

  useEffect(() => {
    if (!wallet) {
      setTargets({});
      return;
    }
    setTargets(readPieTargets(wallet));
    const refresh = () => setTargets(readPieTargets(wallet));
    window.addEventListener(LOCAL_STORE_EVENT, refresh);
    return () => window.removeEventListener(LOCAL_STORE_EVENT, refresh);
  }, [wallet]);

  const allHoldings = query.data?.holdings ?? [];
  const driftRows = useMemo(() => drift(allHoldings, targets), [allHoldings, targets]);
  const allocationScore = rebalanceScore(driftRows);
  const hasTargets = targetsValid(targets);

  const holdings = useMemo(() => {
    const all = query.data?.holdings ?? [];
    return split === "all" ? all : all.filter((row) => row.asset.kind === split);
  }, [query.data?.holdings, split]);

  const solLabel = fromBaseUnits(BigInt(lamportsFrom(query.data?.solLamports) ?? 0), 9);

  // Cost basis for the gain line — after holdings so the first paint is one RPC batch.
  const trades = useWalletTrades(wallet, {enabled: Boolean(query.data)});
  const positions = useMemo(
    () => new Map(trades.positions.map((position) => [position.mint, position])),
    [trades.positions],
  );

  if (!authenticated) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
            <WalletIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[14px] font-bold">Sign in to see your Stonkfolio</p>
          <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
            Your holdings are read from the chain, so nothing is stored here.
          </p>
          <Button variant="primary" className="mt-4" onClick={login}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StickyPageHeader>
        <div className="flex items-center gap-3">
          {/*
            Your X picture, when signing in gave us one. `seed` stays as the
            fallback so a wallet with no X identity still gets a stable
            monogram colour rather than a grey disc — but the picture was
            never passed at all before this, so everyone saw the monogram.
          */}
          <Avatar
            name={displayName ?? handle ?? "?"}
            src={pfpUrl}
            seed={wallet ?? "demo"}
            size={42}
          />
          <div className="min-w-0 flex-1">
            {/*
              Your name, not the screen's name.

              The tab bar already says Stonkfolio, so spending the one large
              line on it again told you nothing — and the X display name you
              signed in with is what makes this read as *your* page rather than
              a generic wallet view. The handle sits beside the address below.
            */}
            <h1 className="truncate text-[18px] font-extrabold tracking-[-0.03em]">
              {displayName ?? handle ?? "Stonkfolio"}
            </h1>
            {handle ? (
              <span className="mr-2 text-[12px] font-semibold text-faint">
                @{handle}
              </span>
            ) : null}
            {wallet ? (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(wallet).then(
                    () => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1600);
                    },
                    () => setCopied(false),
                  );
                }}
                className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold text-faint transition-colors hover:text-muted"
              >
                <span className="font-mono">
                  {copied ? "Copied" : shortPubkey(wallet, 5, 5)}
                </span>
                <CopyIcon className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          {/*
            The gear sits in the header rather than in the tab bar: settings are
            about this account, and the Stonkfolio is the only screen that is.
          */}
          <SettingsMenu />
        </div>

        {/*
          Follows and the edit entry point.

          The counts are buttons because they open the lists — a follower count
          that cannot be tapped is the commonest dead end on a profile. Each
          list anchors to the stat that opened it, so it reads as belonging to
          that number rather than as a new screen.
        */}
        <div className="mt-3 flex items-center gap-4">
          <button
            ref={followersRef}
            type="button"
            onClick={() => setConnections(connections === "followers" ? null : "followers")}
            className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
          >
            <span className="font-extrabold text-ink">
              {compact(me.followerCount)}
            </span>{" "}
            followers
          </button>
          <button
            ref={followingRef}
            type="button"
            onClick={() => setConnections(connections === "following" ? null : "following")}
            className="tabular-nums text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
          >
            <span className="font-extrabold text-ink">
              {compact(me.followingCount)}
            </span>{" "}
            following
          </button>

          {/*
            Share and Edit together at the end of the row: both are about this
            profile, and Share is the one that grows the app — every sign-up
            through the link is credited to whoever shared it.
          */}
          <div className="ml-auto flex items-center gap-1.5">
            {handle ? <ShareProfileButton handle={handle} displayName={displayName} /> : null}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="shrink-0 whitespace-nowrap rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              Edit profile
            </button>
          </div>
        </div>

        {me.bio ? (
          <p className="mt-2 text-[13px] leading-[1.5] text-muted">{me.bio}</p>
        ) : null}

        {me.socials.x || me.socials.telegram || me.socials.website ? (
          <SocialRow socials={me.socials} className="-ml-1.5 mt-1" />
        ) : null}

        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            {scrubbed ? "Value at" : "Stonkfolio value"}
          </div>
          <div className="tabular-nums mt-0.5 text-[30px] font-extrabold leading-none tracking-[-0.035em]">
            {query.isLoading
              ? "—"
              : compactMoney(scrubbed?.value ?? query.data?.totalUsd ?? 0)}
          </div>
          <div className="tabular-nums mt-1.5 flex items-center gap-2 text-[12px] font-bold text-faint">
            {/*
              While scrubbing, the line under the number is the time being
              pointed at rather than the wallet's composition — the composition
              shown is today's and would be wrong for a point last week.
            */}
            {scrubbed ? (
              <span>{stamp(new Date(scrubbed.t).toISOString())}</span>
            ) : (
              <>
                {history.change ? (
                  <PriceDelta
                    value={history.change.pct}
                    className="text-[12px] font-bold"
                  />
                ) : null}
                <span>{solLabel} SOL</span>
                {/*
                  Counted and named rather than folded into the total. The
                  number above is what this app can price, not everything in
                  the wallet.
                */}
                {query.data && query.data.otherCount > 0 ? (
                  <span>· {query.data.otherCount} not priced here</span>
                ) : null}
              </>
            )}
          </div>
        </div>

        {wallet ? (
          <WalletActionsRow
            onSend={() => setSendOpen(true)}
            onReceive={() => setReceiveOpen(true)}
            disabled={isDemo}
          />
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <FilterRail
            label="Chart view"
            options={CHART_MODES}
            value={chartMode}
            onChange={setChartMode}
            className="mb-0 min-w-0 flex-1 !mx-0 !px-0"
          />
          {chartMode === "trend" && (history.ready || history.points.length > 0) ? (
            <RangePills value={range} onChange={setRange} />
          ) : chartMode === "pie" ? (
            <button
              type="button"
              onClick={() => setEditTargetsOpen(true)}
              className="shrink-0 rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              Edit targets
            </button>
          ) : null}
        </div>
      </StickyPageHeader>

      <ChartSection
        mode={chartMode}
        points={history.points}
        ready={history.ready}
        loading={history.isLoading}
        onScrub={setScrubbed}
        holdings={allHoldings}
        targets={targets}
        driftRows={driftRows}
        allocationScore={allocationScore}
        hasTargets={hasTargets}
        onRebalance={() => setRebalanceOpen(true)}
      />

      {chartMode === "trend" ? (
        <div className="pb-3.5 pt-1">
          <FilterRail label="Split holdings" options={SPLITS} value={split} onChange={setSplit} />
        </div>
      ) : null}

      {isDemo ? (
        <p className="mb-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2 text-[11.5px] font-medium leading-[1.45] text-faint shadow-inset-soft">
          Demo mode reads a sample wallet. Add a Privy app id to see your own.
        </p>
      ) : null}

      {query.data?.stale ? (
        <p className="mb-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2 text-[11.5px] font-medium leading-[1.45] text-faint shadow-inset-soft">
          Balances are from cache while Solana RPC catches up. Pull to refresh in
          a moment.
        </p>
      ) : null}

      {chartMode === "trend" ? (
        query.isLoading ? (
          <ul>
            {Array.from({length: 5}).map((_unused, index) => (
              <li key={index} className="flex items-center gap-3 py-3.5">
                <div className="h-10 w-10 animate-pulse rounded-full bg-wash" />
                <div className="flex-1">
                  <div className="h-3.5 w-20 animate-pulse rounded bg-wash" />
                  <div className="mt-2 h-3 w-14 animate-pulse rounded bg-wash" />
                </div>
                <div className="h-8 w-16 animate-pulse rounded bg-wash" />
              </li>
            ))}
          </ul>
        ) : query.error ? (
          <p className="py-10 text-center text-[13.5px] text-muted">
            {(query.error as Error).message}
          </p>
        ) : holdings.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[14px] font-bold">Nothing here yet</p>
            <p className="mx-auto mt-1.5 max-w-[32ch] text-[13px] leading-[1.5] text-muted">
              Buy a coin priced in a tokenized stock and it shows up here.
            </p>
            <Link
              href="/home"
              className="mt-4 inline-flex h-10 items-center rounded-full bg-brand-500 px-5 text-[13.5px] font-extrabold text-white shadow-brand"
            >
              Browse the feed
            </Link>
          </div>
        ) : (
          <ul className="-mx-[22px]">
            {holdings.map((holding) => (
              <li key={`${holding.asset.kind}:${holding.asset.id}`}>
                <HoldingRow
                  holding={holding}
                  position={positions.get(holding.asset.mint)}
                />
              </li>
            ))}
          </ul>
        )
      ) : null}

      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />

      {wallet ? (
        <>
          <EditTargetsSheet
            open={editTargetsOpen}
            onClose={() => setEditTargetsOpen(false)}
            holdings={allHoldings}
            initialTargets={targets}
            onSave={(next) => {
              writePieTargets(wallet, next);
              setTargets(next);
            }}
          />
          <RebalanceSheet
            open={rebalanceOpen}
            onClose={() => setRebalanceOpen(false)}
            holdings={allHoldings}
            targets={targets}
            wallet={wallet}
            slippageBps={readSlippageBps()}
            isDemo={isDemo}
          />
          <SendSheet
            open={sendOpen}
            onClose={() => setSendOpen(false)}
            wallet={wallet}
            solLamports={lamportsFrom(query.data?.solLamports) ?? 0}
            onSent={() => void queryClient.invalidateQueries({queryKey: ["stonkfolio", wallet]})}
          />
          <ReceiveSheet
            open={receiveOpen}
            onClose={() => setReceiveOpen(false)}
            wallet={wallet}
          />
        </>
      ) : null}

      <ConnectionsSheet
        open={connections === "followers"}
        anchorRef={followersRef}
        title="Followers"
        people={me.followers}
        loading={me.isLoading}
        emptyLabel="Nobody follows you yet. Comment on a coin and people will find you."
        onClose={() => setConnections(null)}
      />
      <ConnectionsSheet
        open={connections === "following"}
        anchorRef={followingRef}
        title="Following"
        people={me.following}
        loading={me.isLoading}
        emptyLabel="You are not following anyone yet. Tap a name in the comments to start."
        onClose={() => setConnections(null)}
      />
    </div>
  );
}

const RANGES: FilterOption<BalanceRange>[] = [
  {value: "1d", label: "1D"},
  {value: "1w", label: "1W"},
  {value: "1m", label: "1M"},
  {value: "all", label: "All"},
];

/** Smaller than FilterRail — sits beside Trend/Pie without dominating the row. */
function RangePills({
  value,
  onChange,
}: {
  value: BalanceRange;
  onChange: (next: BalanceRange) => void;
}) {
  return (
    <div role="group" aria-label="Chart range" className="flex shrink-0 gap-0.5">
      {RANGES.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10.5px] font-extrabold leading-none transition-colors",
              active
                ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                : "bg-[var(--overlay-wash)] font-semibold text-faint hover:text-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Trend line or allocation pie — controls live in the sticky header above. */
function ChartSection({
  mode,
  points,
  ready,
  loading,
  onScrub,
  holdings,
  targets,
  driftRows,
  allocationScore,
  hasTargets,
  onRebalance,
}: {
  mode: ChartMode;
  points: readonly BalancePoint[];
  ready: boolean;
  loading: boolean;
  onScrub: (point: BalancePoint | null) => void;
  holdings: readonly Holding[];
  targets: Record<string, number>;
  driftRows: ReturnType<typeof drift>;
  allocationScore: number;
  hasTargets: boolean;
  onRebalance: () => void;
}) {
  return (
    <div className="mt-3">
      {mode === "pie" ? (
        <>
          <AllocationChart
            holdings={holdings}
            targets={targets}
            driftRows={driftRows}
            targetsActive={hasTargets}
            showTargetsHint
            className="-mx-[22px]"
          />
          {hasTargets && allocationScore >= REBALANCE_THRESHOLD ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={onRebalance}
                className="rounded-full bg-brand-500 px-3.5 py-2 text-[13px] font-extrabold text-white shadow-brand transition-colors hover:bg-brand-600"
              >
                Rebalance
              </button>
            </div>
          ) : hasTargets ? (
            <p className="mt-3 text-[12px] font-semibold text-faint">
              Within {REBALANCE_THRESHOLD}% of targets
            </p>
          ) : null}
        </>
      ) : points.length >= 1 ? (
        <BalanceChart points={points} onScrub={onScrub} className="-mx-[22px]" />
      ) : loading ? (
        <div className="h-[132px] rounded-2xl bg-[var(--segment-track)] shadow-inset-soft" />
      ) : !ready ? (
        <div className="grid h-[132px] place-items-center rounded-2xl bg-[var(--segment-track)] px-6 text-center shadow-inset-soft">
          <p className="max-w-[34ch] text-[12px] leading-[1.5] text-faint">
            Balance history is not available in this environment. Your live
            total above still reflects what the chain holds right now.
          </p>
        </div>
      ) : (
        <div className="grid h-[132px] place-items-center rounded-2xl bg-[var(--segment-track)] px-6 text-center shadow-inset-soft">
          <p className="max-w-[34ch] text-[12px] leading-[1.5] text-faint">
            Your balance chart starts from the first time Trador sees this
            wallet. Check back shortly — there is no way to know what it was
            worth before then.
          </p>
        </div>
      )}
    </div>
  );
}
