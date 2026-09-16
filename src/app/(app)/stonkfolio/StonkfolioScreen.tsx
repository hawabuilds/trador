"use client";

import {useMemo, useRef, useState} from "react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";

import {StickyPageHeader} from "@/components/AppShell";
import {BalanceChart, type BalancePoint} from "@/components/BalanceChart";
import {assetHref} from "@/components/AssetRow";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {Avatar} from "@/components/ui/Avatar";
import {Button} from "@/components/ui/Button";
import {PairTicker, VerifiedTick} from "@/components/ui/Badges";
import {CopyIcon, SettingsIcon, WalletIcon} from "@/components/ui/Icons";
import {ConnectionsSheet} from "@/components/ConnectionsSheet";
import {EditProfileSheet} from "@/components/EditProfileSheet";
import {SettingsMenu} from "@/components/SettingsMenu";
import {SocialRow} from "@/components/SocialRow";
import {PriceDelta} from "@/components/ui/PriceDelta";
import {WalletTradeList} from "@/components/WalletTradeList";
import {useBalanceHistory, type BalanceRange} from "@/hooks/useBalanceHistory";
import {useMe} from "@/hooks/useMe";
import {useUser} from "@/hooks/useUser";
import {useWalletTrades} from "@/hooks/useWalletTrades";
import {cn} from "@/lib/cn";
import {holdingProfit, signedMoney, type Position} from "@/lib/walletTrades";
import {compact, compactMoney, stamp, units} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import {shortPubkey} from "@/lib/pubkey";
import type {Holding} from "@/lib/types";

type View = "holdings" | "history";

const VIEWS: FilterOption<View>[] = [
  {value: "holdings", label: "Holdings"},
  {value: "history", label: "History"},
];

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
  const [view, setView] = useState<View>("holdings");
  const [split, setSplit] = useState<Split>("all");
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [range, setRange] = useState<BalanceRange>("1w");
  const [scrubbed, setScrubbed] = useState<BalancePoint | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [connections, setConnections] = useState<"followers" | "following" | null>(null);

  const followersRef = useRef<HTMLButtonElement>(null);
  const followingRef = useRef<HTMLButtonElement>(null);

  const me = useMe();

  const query = useQuery({
    queryKey: ["stonkfolio", wallet],
    enabled: Boolean(wallet),
    queryFn: async (): Promise<StonkfolioResponse> => {
      const response = await fetch(`/api/stonkfolio?wallet=${wallet}`);
      const body = (await response.json()) as StonkfolioResponse;
      if (!response.ok) throw new Error(body.error ?? "Could not read your wallet.");
      return body;
    },
    refetchInterval: 30_000,
  });

  const history = useBalanceHistory(wallet, range, query.data?.totalUsd ?? null);

  const holdings = useMemo(() => {
    const all = query.data?.holdings ?? [];
    return split === "all" ? all : all.filter((row) => row.asset.kind === split);
  }, [query.data?.holdings, split]);

  const sol = (query.data?.solLamports ?? 0) / 1_000_000_000;

  // Loaded for both views: history lists it, holdings take their cost from it.
  const trades = useWalletTrades(wallet);
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
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--overlay-wash)] hover:text-ink"
          >
            <SettingsIcon className="h-[19px] w-[19px]" />
          </button>
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

          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="ml-auto rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
          >
            Edit profile
          </button>
        </div>

        {me.bio ? (
          <p className="mt-2 text-[13px] leading-[1.5] text-muted">{me.bio}</p>
        ) : null}

        {me.socials.x || me.socials.telegram || me.socials.website ? (
          <SocialRow socials={me.socials} className="-ml-1.5 mt-1" />
        ) : null}

        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">
            {/*
              "Portfolio value", not "Trador value". The app's name on the
              number read as though it were some Trador-specific figure rather
              than what the wallet is worth — and now that holdings are read
              from the live store rather than a frozen snapshot, it is simply
              the portfolio.
            */}
            {scrubbed ? "Value at" : "Portfolio value"}
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
                <span>{sol.toFixed(3)} SOL</span>
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

        <BalanceSection
          points={history.points}
          ready={history.ready}
          range={range}
          onRange={setRange}
          onScrub={setScrubbed}
        />

        <div className="space-y-2.5 py-3.5">
          <FilterRail label="Holdings or history" options={VIEWS} value={view} onChange={setView} />
          {view === "holdings" ? (
            <FilterRail label="Split holdings" options={SPLITS} value={split} onChange={setSplit} />
          ) : null}
        </div>
      </StickyPageHeader>

      {isDemo ? (
        <p className="mb-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2 text-[11.5px] font-medium leading-[1.45] text-faint shadow-inset-soft">
          Demo mode reads a sample wallet. Add a Privy app id to see your own.
        </p>
      ) : null}

      {view === "history" ? (
        <WalletTradeList
          trades={trades.trades}
          assets={trades.assets}
          isLoading={trades.isLoading}
          error={trades.error}
          notice={trades.notice}
          hasMore={trades.hasMore}
          loadingMore={trades.loadingMore}
          onLoadMore={trades.loadMore}
          onRetry={trades.retry}
        />
      ) : query.isLoading ? (
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
              <HoldingRow holding={holding} position={positions.get(holding.asset.mint)} />
            </li>
          ))}
        </ul>
      )}

      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EditProfileSheet open={editOpen} onClose={() => setEditOpen(false)} />

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

function HoldingRow({holding, position}: {holding: Holding; position?: Position}) {
  const {asset} = holding;
  const stock = asset.kind === "stock";
  const symbol = stock ? asset.ticker : asset.symbol;
  const profit = holdingProfit(holding.amount, holding.valueUsd, position);

  return (
    <Link
      href={assetHref(asset)}
      className="flex items-center gap-3 px-[22px] py-[13px] transition-colors hover:bg-[var(--overlay-wash)]"
    >
      {stock ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--overlay-wash)] text-[12px] font-extrabold text-muted">
          {symbol.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        // The feed row passes the art and this row didn't, so a coin showed
        // its picture everywhere except the screen listing what you own.
        <Avatar name={symbol} src={asset.imageUrl} seed={asset.mint} size={40} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-extrabold tracking-[-0.015em]">
            {symbol}
          </span>
          {stock ? <VerifiedTick size={14} /> : <PairTicker ticker={asset.quoteTicker} />}
        </div>
        <div className="tabular-nums mt-[3px] text-[12.5px] font-semibold text-faint">
          {units(holding.amount)} {symbol} · {formatPriceUsd(asset.price.usd)}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div
          className={cn(
            "tabular-nums text-[15px] font-extrabold tracking-[-0.02em]",
            holding.valueUsd === null && "text-faint",
          )}
        >
          {/* Unpriced says so. It is not worth zero. */}
          {holding.valueUsd === null ? "Unpriced" : compactMoney(holding.valueUsd)}
        </div>
        {/*
          Profit on what is held: worth now minus what it cost. Only shown
          when the trade history covers the purchase. A leading ~ means part of
          the holding arrived without a known price (a transfer, an airdrop, a
          token-for-token swap), so the figure covers only the bought part.
        */}
        {profit ? (
          <div
            title={
              profit.partial
                ? "Covers only the part of this holding with a known purchase price."
                : "Current value minus what you paid."
            }
            className={cn(
              "tabular-nums mt-[3px] text-[12.5px] font-bold",
              profit.usd >= 0 ? "text-price-up" : "text-price-down",
            )}
          >
            {profit.partial ? "~" : ""}
            {signedMoney(profit.usd)}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

const RANGES: FilterOption<BalanceRange>[] = [
  {value: "1d", label: "1D"},
  {value: "1w", label: "1W"},
  {value: "1m", label: "1M"},
  {value: "all", label: "All"},
];

/**
 * The balance line, or an honest explanation of why there isn't one.
 *
 * Three states, and the distinction between the last two is the point:
 *
 *   - **Points** — draw them.
 *   - **Not ready** — no store is configured, so there will never be history.
 *     Saying "your history starts now" here would be a promise the deployment
 *     cannot keep.
 *   - **Ready but empty** — this wallet has simply not been seen for long
 *     enough yet. That is a wait, and it ends.
 *
 * What it never does is draw a line back to zero from the first point. Nothing
 * on chain records what a wallet was worth before the app first looked, and a
 * fabricated history on a balance chart is the one lie a user cannot detect.
 */
function BalanceSection({
  points,
  ready,
  range,
  onRange,
  onScrub,
}: {
  points: readonly BalancePoint[];
  ready: boolean;
  range: BalanceRange;
  onRange: (next: BalanceRange) => void;
  onScrub: (point: BalancePoint | null) => void;
}) {
  if (!ready) return null;

  return (
    <div className="mt-3">
      {points.length >= 2 ? (
        <BalanceChart points={points} onScrub={onScrub} className="-mx-[22px]" />
      ) : (
        <div className="grid h-[132px] place-items-center rounded-2xl bg-[var(--segment-track)] px-6 text-center shadow-inset-soft">
          <p className="max-w-[34ch] text-[12px] leading-[1.5] text-faint">
            Your balance chart starts from the first time Trador sees this
            wallet. Check back shortly — there is no way to know what it was
            worth before then.
          </p>
        </div>
      )}

      <div className="pt-3">
        <FilterRail
          label="Chart range"
          options={RANGES}
          value={range}
          onChange={onRange}
        />
      </div>
    </div>
  );
}
