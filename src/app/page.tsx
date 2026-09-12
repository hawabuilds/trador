import Link from "next/link";

import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {snapshotStonks} from "@/lib/server/snapshot";
import {STOCK_MINTS} from "@/lib/stocks/registry";

/**
 * The landing screen.
 *
 * No wallet vocabulary anywhere on it. Someone arriving here has not agreed to
 * learn what a mint is yet, and the fastest way to lose them is to ask. The
 * three counts are real — read from the captured universe and the verified
 * registry — because a number that turns out to be decoration is worse than no
 * number at all.
 */
export default function LandingPage() {
  const stonks = snapshotStonks().items;
  const stocksTradedAgainst = new Set(stonks.map((stonk) => stonk.quoteTicker));

  return (
    <main className="flex h-full flex-col justify-between px-7 pb-10 pt-[calc(56px+env(safe-area-inset-top,0px))]">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-brand-400">
          Solana
        </p>
        <h1 className="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-[-0.04em] text-ink">
          {APP_TAGLINE}
        </h1>
        <p className="mt-4 max-w-[31ch] text-[14px] leading-[1.6] text-muted">
          {APP_SUBTITLE}
        </p>

        <dl className="mt-9 grid grid-cols-3 gap-2.5">
          <Stat value={stonks.length.toLocaleString()} label="Stonks" />
          <Stat value={String(stocksTradedAgainst.size)} label="Stocks traded" />
          <Stat value={String(STOCK_MINTS.length)} label="Verified" />
        </dl>
      </div>

      <div>
        <Link
          href="/home"
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-brand-500 text-[15px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
        >
          Open {APP_NAME}
        </Link>
        <Link
          href="/learn"
          className="mt-2.5 flex h-[48px] w-full items-center justify-center rounded-full text-[14px] font-bold text-muted transition-colors duration-150 hover:text-ink"
        >
          What is a tokenized stock?
        </Link>
      </div>
    </main>
  );
}

function Stat({value, label}: {value: string; label: string}) {
  return (
    <div className="rounded-[14px] bg-[var(--overlay-wash)] px-3 py-2.5">
      <dd className="tabular-nums text-[20px] font-extrabold leading-none tracking-[-0.02em] text-ink">
        {value}
      </dd>
      <dt className="mt-1.5 text-[10.5px] font-bold text-faint">{label}</dt>
    </div>
  );
}
