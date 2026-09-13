"use client";

import {useMemo, useState} from "react";
import Link from "next/link";

import {StickyPageHeader} from "@/components/AppShell";
import {FilterRail, type FilterOption} from "@/components/FilterRail";
import {LaunchpadMark} from "@/components/LaunchpadMark";
import {Button} from "@/components/ui/Button";
import {SearchBar} from "@/components/ui/SearchBar";
import {ArrowUpRightIcon, CheckIcon, LockIcon, RocketIcon} from "@/components/ui/Icons";
import {useLearn} from "@/hooks/useLearn";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {LAUNCHPADS, type LaunchpadId} from "@/lib/programs";
import {STOCK_MINTS, stocksByPopularity} from "@/lib/stocks/registry";

const LAUNCHPAD_OPTIONS: FilterOption<LaunchpadId>[] = [
  {value: "stonkfun", label: "StonkFun"},
  {value: "pumpfun", label: "pump.fun"},
];

interface LaunchPlan {
  launchpadLabel: string;
  steps: {label: string; detail: string}[];
  estimatedSol: number | null;
  blocked: string | null;
  checks: {label: string; value: string; ok: boolean | null}[];
}

/**
 * Create — launch a coin priced in a tokenized stock.
 *
 * Gated on finishing Learn, because the thing being created has a real
 * consequence for whoever buys it: the pairing decides what they are actually
 * exposed to, and five minutes of reading is a fair price for the button.
 *
 * The flow plans the launch against live chain state and shows exactly what it
 * would do, then says plainly that it will not sign. That is not a placeholder
 * — see the note in `lib/server/live/launch.ts` for why signing an unverified
 * create instruction on mainnet is the one thing this app should not offer.
 */
export function CreateScreen() {
  const learn = useLearn();
  const {authenticated, wallet, login} = useUser();

  const [launchpad, setLaunchpad] = useState<LaunchpadId>("stonkfun");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quoteTicker, setQuoteTicker] = useState("NVDAx");
  const [stockFilter, setStockFilter] = useState("");
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stocks = useMemo(() => {
    const needle = stockFilter.trim().toLowerCase(); // pubkey-lint-ok: a text filter
    const ranked = stocksByPopularity();
    if (!needle) return ranked.slice(0, 12);
    return ranked
      .filter(
        (stock) =>
          stock.ticker.toLowerCase().includes(needle) ||
          stock.name.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [stockFilter]);

  const ready = name.trim().length > 0 && symbol.trim().length > 0 && authenticated;

  async function planIt() {
    setPlanning(true);
    setError(null);
    try {
      const response = await fetch("/api/launch/simulate", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({launchpad, name, symbol, quoteTicker, creator: wallet}),
      });
      const body = (await response.json()) as LaunchPlan & {error?: string};
      if (!response.ok) throw new Error(body.error ?? "Could not plan this launch.");
      setPlan(body);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPlanning(false);
    }
  }

  // Learn gate. Rendered before anything else so the screen cannot be used
  // past it, rather than disabling a button at the end of a filled-in form.
  if (learn.hydrated && !learn.allDone) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-wash text-faint">
            <LockIcon className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[14px] font-bold">Finish Learn to unlock Create</p>
          <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-[1.5] text-muted">
            Pricing a coin in a stock changes what its buyers are exposed to.
            Three lessons, about five minutes.
          </p>
          <Link
            href="/learn"
            className="mt-4 inline-flex h-10 items-center rounded-full bg-brand-500 px-5 text-[13.5px] font-extrabold text-white shadow-brand"
          >
            Open Learn ({learn.done}/3)
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StickyPageHeader>
        <h1 className="text-[22px] font-extrabold tracking-[-0.035em]">Create</h1>
        <p className="mb-4 mt-0.5 text-[12.5px] font-medium text-faint">
          Launch a coin priced in a tokenized stock
        </p>
      </StickyPageHeader>

      <div className="py-1">
        <Label>Launchpad</Label>
        <FilterRail
          label="Launchpad"
          options={LAUNCHPAD_OPTIONS}
          value={launchpad}
          onChange={(next) => {
            setLaunchpad(next);
            setPlan(null);
          }}
        />

        <div className="mt-2 flex items-start gap-2.5 rounded-2xl bg-surface-card p-3 shadow-card">
          <LaunchpadMark launchpad={launchpad} size={22} />
          <p className="text-[12.5px] leading-[1.5] text-muted">
            {launchpad === "stonkfun"
              ? "Runs on Raydium LaunchLab. The coin trades on a bonding curve denominated in the stock, then graduates into a real pool. Reward launches route a share of every trade back to holders."
              : "pump.fun Custom Pairs. The coin trades in a PumpSwap pool whose quote asset is the stock — not a SOL curve."}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <Label>Name</Label>
        <Input value={name} onChange={setName} placeholder="DividendCoin" max={32} />
      </div>

      <div className="mt-4">
        <Label>Symbol</Label>
        <Input
          value={symbol}
          onChange={(next) => setSymbol(next.toUpperCase())}
          placeholder="DIVI"
          max={10}
        />
      </div>

      <div className="mt-5">
        <Label>Priced in</Label>
        <SearchBar
          value={stockFilter}
          onChange={setStockFilter}
          placeholder={`Search ${STOCK_MINTS.length} verified stocks`}
          label="Search stocks"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {stocks.map((stock) => (
            <button
              key={stock.mint}
              type="button"
              onClick={() => {
                setQuoteTicker(stock.ticker);
                setPlan(null);
              }}
              aria-pressed={quoteTicker === stock.ticker}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12.5px] font-extrabold transition-colors",
                quoteTicker === stock.ticker
                  ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                  : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
              )}
            >
              {stock.ticker}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
          {quoteTicker
            ? `Buyers of ${symbol || "your coin"} will be priced against ${quoteTicker}, not SOL.`
            : "Pick the stock your coin is priced against."}
        </p>
      </div>

      <div className="mt-6">
        {!authenticated ? (
          <Button variant="primary" fullWidth onClick={login}>
            Sign in to continue
          </Button>
        ) : (
          <Button
            variant="dark"
            fullWidth
            disabled={!ready || planning}
            onClick={() => void planIt()}
          >
            {planning ? "Checking…" : "Check this launch"}
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-[12.5px] font-semibold text-price-down">
          {error}
        </p>
      ) : null}

      {plan ? (
        <div className="mt-5">
          <Label>What this would do</Label>
          <ol className="overflow-hidden rounded-2xl bg-surface-card shadow-card">
            {plan.steps.map((step, index) => (
              <li
                key={step.label}
                className="flex gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40"
              >
                <span className="tabular-nums grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] bg-[var(--overlay-wash)] text-[11px] font-extrabold text-muted">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-extrabold">{step.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.45] text-muted">
                    {step.detail}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <Label className="mt-5">Checks</Label>
          <ul className="overflow-hidden rounded-2xl bg-surface-card shadow-card">
            {plan.checks.map((check) => (
              <li
                key={check.label}
                className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40"
              >
                <span className="text-[12.5px] font-bold text-faint">{check.label}</span>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 text-right text-[12.5px] font-extrabold",
                    check.ok === true && "text-price-up",
                    check.ok === false && "text-price-down",
                    check.ok === null && "text-faint",
                  )}
                >
                  {check.ok === true ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                  {check.value}
                </span>
              </li>
            ))}
            {plan.estimatedSol !== null ? (
              <li className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40">
                <span className="text-[12.5px] font-bold text-faint">Estimated cost</span>
                <span className="tabular-nums text-[12.5px] font-extrabold">
                  ~{plan.estimatedSol} SOL
                </span>
              </li>
            ) : null}
          </ul>

          {plan.blocked ? (
            <div className="mt-4 rounded-2xl bg-[var(--segment-track)] p-3.5 shadow-inset-soft">
              <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold">
                <RocketIcon className="h-4 w-4 text-faint" />
                Not signing yet
              </p>
              <p className="mt-1.5 text-[12px] leading-[1.55] text-muted">{plan.blocked}</p>
              <a
                href={LAUNCHPADS[launchpad].url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-extrabold text-accent-link"
              >
                Launch on {plan.launchpadLabel}
                <ArrowUpRightIcon className="h-3.5 w-3.5" />
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Label({children, className}: {children: React.ReactNode; className?: string}) {
  return (
    <div
      className={cn(
        "mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  max: number;
}) {
  return (
    <input
      value={value}
      maxLength={max}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-2xl bg-[var(--bg-input)] px-[15px] py-[13px] text-[14.5px] font-medium text-ink shadow-inset-soft outline-none transition-[box-shadow] duration-200 placeholder:text-faint focus-within:shadow-inset-focus"
    />
  );
}
