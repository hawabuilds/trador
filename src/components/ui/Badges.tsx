"use client";

import {launchpadFace} from "@/config/launchpads";
import {cn} from "@/lib/cn";
import type {LaunchpadId} from "@/lib/programs";
import type {StockKind} from "@/lib/stocks/registry";
import {LaunchpadMark} from "../LaunchpadMark";
import {VerifiedIcon} from "./Icons";

const STOCK_KIND_LABEL: Record<StockKind, string> = {
  equity: "Stock",
  etf: "ETF",
  "pre-ipo": "Pre-IPO",
  commodity: "Commodity",
};

/**
 * The mark on a verified tokenized stock.
 *
 * Icon only, no label: it sits directly beside the ticker in a dense list, and
 * a word there would compete with the one piece of text the row is actually
 * scanned for. The title and screen-reader text carry the meaning.
 *
 * What it vouches for is specific — that the mint's authority belongs to an
 * issuer the registry has verified — so the default label says so rather than
 * implying a general endorsement.
 */
export function VerifiedTick({
  size = 15,
  label = "Verified tokenized stock",
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      className={cn("inline-flex shrink-0 text-brand-400", className)}
    >
      <VerifiedIcon style={{width: size, height: size}} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The stock a coin is priced against, as it appears in a list row.
 *
 * Just the ticker. In context — immediately after the coin's symbol — the
 * pairing reads without a label, and it is the single most important thing on
 * the row after the symbol itself: a coin quoted in NVDAx is not the same asset
 * as the same coin quoted in SOL.
 */
export function PairTicker({
  ticker,
  className,
}: {
  ticker: string;
  className?: string;
}) {
  return (
    <span
      title={`Priced in ${ticker}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px]",
        // Not `uppercase`. Issuers spell these tickers with a meaningful
        // lowercase suffix — the `x` in NVDAx is what marks it as an xStock
        // rather than the equity — so forcing case would erase information.
        "text-[10.5px] font-extrabold leading-none tracking-[0.03em] text-muted",
        className,
      )}
    >
      {ticker}
    </span>
  );
}

export function TypeBadge({
  kind,
  className,
}: {
  kind: StockKind;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px]",
        "text-[10.5px] font-extrabold uppercase leading-none tracking-[0.03em] text-faint",
        className,
      )}
    >
      {STOCK_KIND_LABEL[kind]}
    </span>
  );
}

/**
 * Shown when a coin's pool liquidity is below the tradeable floor.
 *
 * Rendered only when the flag is actually `false`. A coin whose liquidity has
 * not been measured yet is `null`, and labelling that as illiquid would be a
 * guess presented as a fact.
 */
export function NoLiquidityChip() {
  return (
    <span
      title="Pool liquidity is below the tradeable floor"
      className="inline-flex shrink-0 items-center rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px] text-[10.5px] font-extrabold uppercase leading-none tracking-[0.03em] text-faint"
    >
      No liquidity
    </span>
  );
}

/**
 * The launchpad a coin came from, proved from program state.
 *
 * Carries that launchpad's real mark, and — when the chip is given a mint —
 * links to that launchpad's own page for the coin. The link is the point:
 * "StonkFun" as bare text is a label, whereas a chip that opens the coin on
 * StonkFun is the fastest way to check our attribution against theirs.
 *
 * Rendered as an `<a>` only when there is somewhere to go. A chip with no mint
 * stays a `<span>` rather than becoming a link to a page that would 404.
 */
export function LaunchpadChip({
  launchpad,
  mint,
  className,
}: {
  launchpad: LaunchpadId;
  /** Links to the coin's page on that launchpad. Omit for a plain label. */
  mint?: string | null;
  className?: string;
}) {
  const face = launchpadFace(launchpad);

  const body = (
    <>
      <LaunchpadMark launchpad={launchpad} size={13} className="rounded-[3px]" />
      {face.label}
    </>
  );

  const shared = cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--overlay-wash)] px-[7px] py-[3px]",
    "text-[10.5px] font-extrabold leading-none tracking-[0.02em] text-faint",
    className,
  );

  if (!mint) {
    return (
      <span title={`Launched on ${face.label}`} className={shared}>
        {body}
      </span>
    );
  }

  return (
    <a
      href={face.coinUrl(mint)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open on ${face.label}`}
      // `stopPropagation` because these chips sit inside rows that are
      // themselves links. Without it, tapping the launchpad would navigate to
      // the coin's page in this app — the one place the tap was not aiming for.
      onClick={(event) => event.stopPropagation()}
      className={cn(
        shared,
        "transition-colors hover:bg-[var(--overlay-wash-hover)] hover:text-ink",
      )}
    >
      {body}
    </a>
  );
}
