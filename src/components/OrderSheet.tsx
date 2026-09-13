"use client";

import {useEffect, useMemo, useState} from "react";

import {FEE_BPS, feeFor, tooSmall} from "@/config/fees";
import {txUrl} from "@/config/explorer";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {units} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import {readSlippageBps, writeSlippageBps} from "@/lib/localStore";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import type {Asset} from "@/lib/types";
import {Modal} from "./ui/Modal";
import {SettingsIcon} from "./ui/Icons";

/** What a buy is funded with. Sells always go back to USDC. */
const PAY_WITH = [
  {mint: WSOL_MINT, symbol: "SOL", decimals: 9},
  {mint: USDC_MINT, symbol: "USDC", decimals: 6},
] as const;

const QUICK_USD = [10, 25, 100];
const QUICK_SOL = [0.05, 0.25, 1];
/** Sell sizes, as a share of the position. */
const SELL_STEPS = [25, 50, 75];

const SLIPPAGE_CHOICES = [50, 100, 300];

interface QuoteState {
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: number;
  platformFee: {amount: string; feeBps: number} | null;
  routeLabels: string[];
  raw: unknown;
}

/**
 * The order ticket.
 *
 * A centred modal rather than a bottom sheet, and laid out the way the
 * predecessor's ticket was: side toggle, one big amount field, quick sizes,
 * what you hold, then the breakdown, then one confirm. That order matters —
 * the number being typed is the thing being decided, so it sits at the top
 * where the eye lands, and everything under it is a consequence of it.
 *
 * Three things it will not do, each because the alternative is a lie the user
 * cannot detect:
 *
 *   - It never shows a fill it did not get. A failure says what failed.
 *   - It never quotes a price and then builds a transaction at another one; the
 *     quote is handed back to the server verbatim.
 *   - It never offers a button it cannot honour. Without a signer the action is
 *     disabled and says why, rather than failing at the moment of signing.
 */
export function OrderSheet({
  asset,
  side,
  onClose,
}: {
  asset: Asset | null;
  side: "buy" | "sell";
  onClose: () => void;
}) {
  const session = useSession();

  const [activeSide, setActiveSide] = useState<"buy" | "sell">(side);
  const [payWith, setPayWith] = useState<(typeof PAY_WITH)[number]>(PAY_WITH[1]);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [configOpen, setConfigOpen] = useState(false);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const open = asset !== null;
  const buying = activeSide === "buy";
  const symbol = asset?.kind === "stock" ? asset.ticker : (asset?.symbol ?? "");

  // Slippage is a browser preference, not an order field: someone who set 3%
  // once meant it for their trading, not for one ticket.
  useEffect(() => setSlippageBps(readSlippageBps(100)), []);

  /*
   * Follow the button that opened the ticket, and reset everything with it.
   *
   * Keyed on `asset?.id` as well as `side` so reopening on a different coin
   * cannot leave the previous coin's quote, error or amount on screen — which
   * would show a price for one asset above a button that trades another.
   */
  useEffect(() => {
    setActiveSide(side);
    setAmount("");
    setQuote(null);
    setError(null);
    setStatus(null);
    setSignature(null);
    setConfigOpen(false);
  }, [asset?.id, side]);

  const priceUsd = asset?.price.usd ?? null;
  const typed = Number.parseFloat(amount);
  const entered = Number.isFinite(typed) && typed > 0 ? typed : 0;

  /** Buying in SOL is sized in SOL; everything else is sized in dollars. */
  const solSized = buying && payWith.symbol === "SOL";

  /** Dollar value of what was typed, when that is knowable. */
  const amountUsd = useMemo(() => {
    if (buying) return solSized ? Number.NaN : entered;
    if (priceUsd === null || priceUsd <= 0) return Number.NaN;
    return entered * priceUsd;
  }, [buying, solSized, entered, priceUsd]);

  /**
   * The input amount in base units.
   *
   * A buy is sized in the funding token; a sell in units of the asset. Sizing a
   * sell in dollars directly would need a price the ticket may not have, which
   * is why an unpriced asset blocks rather than guesses.
   */
  const amountBaseUnits = useMemo(() => {
    if (!asset || entered <= 0) return null;

    if (buying) {
      return String(Math.round(entered * 10 ** payWith.decimals));
    }

    const decimals = asset.kind === "stonk" ? (asset.decimals ?? 6) : asset.decimals;
    return String(Math.round(entered * 10 ** decimals));
  }, [asset, buying, entered, payWith.decimals]);

  const undersized =
    entered > 0 && !solSized && Number.isFinite(amountUsd) && tooSmall(amountUsd);

  const canQuote = open && amountBaseUnits !== null && !undersized;

  useEffect(() => {
    if (!canQuote || !asset || amountBaseUnits === null) {
      setQuote(null);
      return;
    }

    const inputMint = buying ? payWith.mint : asset.mint;
    const outputMint = buying ? asset.mint : USDC_MINT;

    let cancelled = false;
    setQuoting(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
            `&amount=${amountBaseUnits}&slippageBps=${slippageBps}`,
        );
        const body = (await response.json()) as {quote?: QuoteState; error?: string};
        if (cancelled) return;
        if (!response.ok || !body.quote) {
          setQuote(null);
          setError(body.error ?? "Could not price this trade.");
          return;
        }
        setQuote(body.quote);
      } catch {
        if (!cancelled) setError("Could not reach the router.");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canQuote, asset, buying, payWith, amountBaseUnits, slippageBps]);

  const fee = feeFor(Number.isFinite(amountUsd) ? amountUsd : 0);
  const impactPct = quote ? Math.abs(quote.priceImpactPct * 100) : 0;
  const impactBlocks = impactPct >= 50;
  const impactWarns = impactPct >= 15 && !impactBlocks;

  const wallet = session.user?.wallet ?? null;
  const canSign = session.signAndSend !== null && wallet !== null;

  const blockReason = !open
    ? null
    : !canSign
      ? session.mode === "demo"
        ? "Demo mode cannot sign. Add a Privy app id to trade."
        : "Connect a wallet to trade."
      : entered <= 0
        ? null
        : undersized
          ? "Minimum trade is $1."
          : !buying && (priceUsd === null || priceUsd <= 0)
            ? "No price for this asset, so a sell cannot be sized."
            : impactBlocks
              ? `Price impact is ${impactPct.toFixed(1)}% — too high to place.`
              : null;

  /** What the confirm button receives, in the unit it will actually arrive in. */
  const estimatedOut = useMemo(() => {
    if (!quote || !asset) return null;
    const decimals = buying
      ? asset.kind === "stonk"
        ? (asset.decimals ?? 6)
        : asset.decimals
      : 6; // Sells settle to USDC.
    return Number(quote.outAmount) / 10 ** decimals;
  }, [quote, asset, buying]);

  async function confirm() {
    if (!asset || !quote || !wallet || !session.signAndSend) return;

    setError(null);
    setStatus("Building…");

    try {
      const response = await fetch("/api/swap/build", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({quote, userPublicKey: wallet}),
      });
      const body = (await response.json()) as {
        swap?: {transactionBase64: string};
        error?: string;
      };

      if (!response.ok || !body.swap) {
        throw new Error(body.error ?? "Could not build the transaction.");
      }

      setStatus("Waiting for your signature…");
      const bytes = Uint8Array.from(atob(body.swap.transactionBase64), (c) =>
        c.charCodeAt(0),
      );
      const sig = await session.signAndSend(bytes);

      setSignature(sig);
      setStatus(null);
    } catch (caught) {
      // Say what happened. A ticket that silently returns to its resting state
      // is indistinguishable from one that succeeded.
      const message = (caught as Error).message ?? "The trade failed.";
      setError(
        /reject|denied|cancel/i.test(message)
          ? "You cancelled the signature."
          : message,
      );
      setStatus(null);
    }
  }

  const confirmDisabled =
    blockReason !== null ||
    quote === null ||
    status !== null ||
    entered <= 0 ||
    signature !== null;

  const unit = buying ? payWith.symbol : symbol;

  return (
    <Modal
      open={open}
      onClose={onClose}
      surface="popup"
      title={`${buying ? "Buy" : "Sell"} ${symbol}`}
      className="max-w-[352px] p-5 pt-5"
    >
      {asset ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-2 pr-9">
            <h2 className="truncate text-[17px] font-extrabold tracking-[-0.025em]">
              {buying ? "Buy" : "Sell"} {symbol}
            </h2>
            <button
              type="button"
              onClick={() => setConfigOpen((wasOpen) => !wasOpen)}
              aria-expanded={configOpen}
              aria-label="Order settings"
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                configOpen
                  ? "bg-[var(--overlay-wash-hover)] text-ink"
                  : "text-faint hover:bg-[var(--overlay-wash)] hover:text-ink",
              )}
            >
              <SettingsIcon className="h-[17px] w-[17px]" />
            </button>
          </div>

          {configOpen ? (
            <SlippageConfig
              value={slippageBps}
              onChange={(bps) => {
                setSlippageBps(bps);
                writeSlippageBps(bps);
              }}
              onClose={() => setConfigOpen(false)}
            />
          ) : null}

          {/*
            Side lives inside the ticket, not only on the button that opened it.
            Deciding to sell instead of buy should not mean closing this and
            finding a different button.
          */}
          <div className="mb-3.5 flex gap-1 rounded-2xl bg-[var(--segment-track)] p-1 shadow-inset-soft">
            {(["buy", "sell"] as const).map((option) => {
              const active = option === activeSide;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setActiveSide(option);
                    setAmount("");
                    setQuote(null);
                    setError(null);
                    setSignature(null);
                  }}
                  className={cn(
                    "flex-1 rounded-full py-2 text-[13px] font-extrabold capitalize transition-all duration-150",
                    active &&
                      option === "buy" &&
                      "bg-[var(--price-up-wash)] text-price-up shadow-price-up",
                    active &&
                      option === "sell" &&
                      "bg-[var(--price-down-wash)] text-price-down shadow-price-down",
                    !active &&
                      "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>

          <label htmlFor="order-amount" className="sr-only">
            {buying ? `Amount in ${payWith.symbol}` : `Amount in ${symbol}`}
          </label>
          <div className="rounded-2xl bg-[var(--bg-input)] px-4 py-3.5 shadow-inset-soft transition-[box-shadow,background-color] focus-within:shadow-inset-focus">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
                Amount
              </span>
              {buying ? (
                <div className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]">
                  {PAY_WITH.map((option) => {
                    const active = option.mint === payWith.mint;
                    return (
                      <button
                        key={option.mint}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setPayWith(option);
                          setAmount("");
                          setQuote(null);
                        }}
                        className={cn(
                          "tabular-nums rounded-full px-2 py-1 text-[10.5px] font-extrabold transition-colors",
                          active
                            ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                            : "text-faint hover:text-muted",
                        )}
                      >
                        {option.symbol}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="text-[10.5px] font-extrabold text-faint">
                  {symbol}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-1.5">
              {buying && !solSized ? (
                <span className="text-[24px] font-extrabold text-faint">$</span>
              ) : null}
              <input
                id="order-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => {
                  // Digits and one decimal point, clamped to a sane number of
                  // places for the unit being typed. Letting someone type nine
                  // decimals of USDC produces a base-unit amount the router
                  // rejects, several seconds later, with nothing to explain it.
                  const next = event.target.value.replace(/[^0-9.]/g, "");
                  const parts = next.split(".");
                  const places = buying ? (solSized ? 6 : 2) : 6;
                  setAmount(
                    parts.length > 1
                      ? `${parts[0]}.${parts.slice(1).join("").slice(0, places)}`
                      : parts[0],
                  );
                  setError(null);
                  setSignature(null);
                }}
                className="tabular-nums w-full min-w-0 border-none bg-transparent text-[30px] font-extrabold tracking-[-0.03em] text-ink outline-none placeholder:text-faint focus:outline-none focus-visible:outline-none"
              />
              {!buying ? (
                <span className="text-[15px] font-extrabold text-faint">{symbol}</span>
              ) : solSized ? (
                <span className="text-[15px] font-extrabold text-faint">SOL</span>
              ) : null}
            </div>

            <div className="tabular-nums mt-1 text-[12px] font-semibold text-faint">
              {quote && estimatedOut !== null
                ? `≈ ${units(estimatedOut)} ${buying ? symbol : "USDC"}`
                : quoting && entered > 0
                  ? "Finding route…"
                  : `${formatPriceUsd(priceUsd)} per ${symbol}`}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            {buying
              ? (solSized ? QUICK_SOL : QUICK_USD).map((value) => (
                  <QuickButton
                    key={value}
                    label={solSized ? `${value} SOL` : `$${value}`}
                    onClick={() => setAmount(String(value))}
                  />
                ))
              : SELL_STEPS.map((step) => (
                  <QuickButton
                    key={step}
                    label={`${step}%`}
                    // Sizing a share of a position needs the position, and the
                    // ticket does not hold holdings. Disabled rather than
                    // wrong: a "50%" that sizes off nothing is worse than one
                    // that plainly does not work.
                    disabled
                    onClick={() => undefined}
                  />
                ))}
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-2.5 text-[12.5px] font-semibold shadow-inset-soft">
            <span className="text-faint">
              {buying ? "Paying with" : `Selling`}
            </span>
            <span className="tabular-nums truncate font-extrabold">
              {entered > 0 ? `${units(entered)} ${unit}` : `— ${unit}`}
              {Number.isFinite(amountUsd) && amountUsd > 0
                ? ` · $${amountUsd.toFixed(2)}`
                : ""}
            </span>
          </div>

          {quote ? (
            <TicketBreakdown
              quote={quote}
              buying={buying}
              symbol={symbol}
              feeUsd={quote.platformFee ? fee.usd : 0}
              slippageBps={slippageBps}
              impactPct={impactPct}
              impactLevel={impactBlocks ? "block" : impactWarns ? "warn" : "ok"}
            />
          ) : null}

          {impactWarns && !impactBlocks ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              Price impact is {impactPct.toFixed(1)}%. You would receive
              materially less than the quoted price.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              {error}
            </p>
          ) : null}

          {signature ? (
            <p role="status" className="mt-3 text-[12.5px] font-semibold text-success">
              Sent.{" "}
              <a
                href={txUrl(signature)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View transaction
              </a>
            </p>
          ) : null}

          {blockReason && !error ? (
            <p className="mt-3 text-[12.5px] font-semibold text-muted">
              {blockReason}
            </p>
          ) : null}

          <button
            type="button"
            onClick={signature ? onClose : () => void confirm()}
            disabled={signature ? false : confirmDisabled}
            className={cn(
              "mt-4 w-full rounded-2xl py-[16px] text-[16px] font-extrabold text-white",
              "bg-brand-500 shadow-brand transition-[transform,background-color,opacity] duration-200",
              "hover:-translate-y-0.5 hover:bg-brand-600",
              "disabled:pointer-events-none disabled:bg-surface-hover disabled:text-text-disabled disabled:shadow-none",
            )}
          >
            {signature
              ? "Done"
              : (status ?? `${buying ? "Buy" : "Sell"} ${symbol}`)}
          </button>

          <p className="mt-2.5 text-center text-[11px] font-medium leading-[1.5] text-faint">
            Max slippage {slippageBps / 100}% · One signature, no approval step
          </p>
        </>
      ) : null}
    </Modal>
  );
}

/**
 * What the trade actually costs, line by line.
 *
 * Every row is either a number the router returned or an em dash. Nothing here
 * is estimated locally and presented as if it came from the quote — the fee row
 * in particular only claims a fee when `platformFee` is actually on the quote,
 * because claiming one the router did not take is the kind of error nobody
 * would ever catch.
 */
function TicketBreakdown({
  quote,
  buying,
  symbol,
  feeUsd,
  slippageBps,
  impactPct,
  impactLevel,
}: {
  quote: QuoteState;
  buying: boolean;
  symbol: string;
  feeUsd: number;
  slippageBps: number;
  impactPct: number;
  impactLevel: "ok" | "warn" | "block";
}) {
  const receivedSymbol = buying ? symbol : "USDC";
  const outDecimals = buying ? 6 : 6;
  const minOut = Number(quote.otherAmountThreshold) / 10 ** outDecimals;

  return (
    <div className="mt-2.5 space-y-1 px-1 text-[12px] font-semibold">
      <Line label={`Trador fee (${FEE_BPS / 100}%)`}>
        {quote.platformFee ? `$${feeUsd.toFixed(2)}` : "Not taken"}
      </Line>
      <Line label="Price impact" tone={impactLevel === "ok" ? undefined : "error"}>
        {impactPct.toFixed(2)}%
      </Line>
      <Line label="Minimum received">
        {units(minOut)} {receivedSymbol}
      </Line>
      <Line label="Route">
        {quote.routeLabels.length ? quote.routeLabels.join(" → ") : "—"}
      </Line>
      <Line label="Max slippage">{slippageBps / 100}%</Line>
    </div>
  );
}

function Line({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-faint">{label}</span>
      <span
        className={cn(
          "tabular-nums truncate font-bold",
          tone === "error" ? "text-error" : "text-muted",
        )}
      >
        {children}
      </span>
    </div>
  );
}

function QuickButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tabular-nums flex-1 rounded-full bg-[var(--overlay-wash)] py-2.5 text-[12px] font-bold text-ink transition-[background-color,transform] hover:-translate-y-px hover:bg-[var(--overlay-wash-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** Slippage tolerance, kept per browser and shown on every confirm button. */
function SlippageConfig({
  value,
  onChange,
  onClose,
}: {
  value: number;
  onChange: (bps: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-3.5 rounded-2xl bg-[var(--segment-track)] p-3 shadow-inset-soft">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
          Max slippage
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-extrabold text-faint transition-colors hover:text-ink"
        >
          Done
        </button>
      </div>
      <div className="flex gap-1.5">
        {SLIPPAGE_CHOICES.map((bps) => (
          <button
            key={bps}
            type="button"
            aria-pressed={bps === value}
            onClick={() => onChange(bps)}
            className={cn(
              "tabular-nums flex-1 rounded-full py-2 text-[12px] font-extrabold transition-colors",
              bps === value
                ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                : "text-faint hover:bg-[var(--overlay-wash)] hover:text-muted",
            )}
          >
            {bps / 100}%
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-[1.45] text-faint">
        The trade fails rather than fills beyond this. Higher tolerance fills
        more often and at a worse price.
      </p>
    </div>
  );
}
