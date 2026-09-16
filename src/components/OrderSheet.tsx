"use client";

import {useEffect, useMemo, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";

import {FEE_BPS, feeFor, tooSmall} from "@/config/fees";
import {balancesKey, useBalances} from "@/hooks/useBalances";
import {WALLET_TRADES_KEY} from "@/hooks/useWalletTrades";
import {
  SOL_FEE_RESERVE_LAMPORTS,
  fromBaseUnits,
  shareOf,
  spendableLamports,
  toBaseUnits,
} from "@/lib/amounts";
import {confirmSignature} from "@/lib/confirmSignature";
import {txUrl} from "@/config/explorer";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {units} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import {
  readSellPayout,
  readSlippageBps,
  writeSellPayout,
  writeSlippageBps,
} from "@/lib/localStore";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import type {Asset} from "@/lib/types";
import {Modal} from "./ui/Modal";
import {SettingsIcon} from "./ui/Icons";

/**
 * What a buy is funded with, and what a sell pays out in.
 *
 * Sells used to settle to USDC unconditionally, which surprised anyone who had
 * bought with SOL and expected SOL back. The same two choices now apply on both
 * sides; a SOL payout arrives as native SOL (the build unwraps it).
 */
const PAY_WITH = [
  {mint: WSOL_MINT, symbol: "SOL", decimals: 9},
  {mint: USDC_MINT, symbol: "USDC", decimals: 6},
] as const;

const QUICK_USD = [10, 25, 100];
const QUICK_SOL = [0.05, 0.25, 1];
/** Sell sizes, as a share of the position. 100 sells the exact balance. */
const SELL_STEPS = [25, 50, 75, 100];

/**
 * SOL a trade funded in something else still needs, for its network fee and
 * possibly rent on a token account it opens. There is no fee sponsorship, so a
 * wallet below this cannot pay for the transaction it is about to be asked to
 * sign.
 */
const MIN_FEE_LAMPORTS = 3_000_000n; // 0.003 SOL

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
  const queryClient = useQueryClient();

  const [activeSide, setActiveSide] = useState<"buy" | "sell">(side);
  const [payWith, setPayWith] = useState<(typeof PAY_WITH)[number]>(PAY_WITH[1]);
  const [receiveIn, setReceiveIn] = useState<(typeof PAY_WITH)[number]>(PAY_WITH[0]);
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
  useEffect(() => {
    setSlippageBps(readSlippageBps(100));
    const payout = readSellPayout();
    setReceiveIn(PAY_WITH.find((option) => option.symbol === payout) ?? PAY_WITH[0]);
  }, []);

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

  const wallet = session.user?.wallet ?? null;
  const canSign = session.signAndSend !== null && wallet !== null;

  /*
   * What the wallet actually holds of this asset and of USDC, plus its SOL.
   *
   * The ticket used to know none of this, so it could not offer a size as a
   * share of a position, had no "sell all", and would happily ask you to sign
   * a trade for more than you own — which then failed in simulation.
   */
  const balanceMints = useMemo(() => (asset ? [asset.mint, USDC_MINT] : []), [asset]);
  const balances = useBalances(wallet, balanceMints, open && wallet !== null);
  const held = asset ? balances.data?.tokens[asset.mint] : undefined;
  const heldRaw = balances.data ? BigInt(held?.amount ?? "0") : null;
  const usdcRaw = balances.data ? BigInt(balances.data.tokens[USDC_MINT]?.amount ?? "0") : null;
  const lamports = balances.data ? BigInt(balances.data.lamports) : null;

  /**
   * The asset's own decimals, which both the estimate and the minimum need.
   *
   * The chain wins over the store when the wallet holds some: the mint account
   * is the only authority on its precision, and a wrong value here sizes a sell
   * a thousandfold off.
   */
  const storedDecimals =
    asset === null ? 6 : asset.kind === "stonk" ? (asset.decimals ?? 6) : asset.decimals;
  const assetDecimals = heldRaw !== null && heldRaw > 0n && held ? held.decimals : storedDecimals;

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
  const amountRaw = useMemo(() => {
    if (!asset) return null;
    // Parsed from the text, not from the float: "sell all" writes the exact
    // balance into the field, and it has to come back out unchanged.
    const parsed = toBaseUnits(amount, buying ? payWith.decimals : assetDecimals);
    return parsed !== null && parsed > 0n ? parsed : null;
  }, [asset, amount, assetDecimals, buying, payWith.decimals]);

  const amountBaseUnits = amountRaw === null ? null : amountRaw.toString();

  /** The most this side can spend, in the unit being typed. */
  const availableRaw = buying
    ? payWith.symbol === "SOL"
      ? lamports === null
        ? null
        : spendableLamports(lamports)
      : usdcRaw
    : heldRaw;
  const availableDecimals = buying ? payWith.decimals : assetDecimals;
  const available =
    availableRaw === null ? null : Number(fromBaseUnits(availableRaw, availableDecimals));
  const overBalance = amountRaw !== null && availableRaw !== null && amountRaw > availableRaw;
  const shortOnFees =
    lamports !== null && !(buying && payWith.symbol === "SOL") && lamports < MIN_FEE_LAMPORTS;

  const undersized =
    entered > 0 && !solSized && Number.isFinite(amountUsd) && tooSmall(amountUsd);

  const canQuote = open && amountBaseUnits !== null && !undersized;

  useEffect(() => {
    if (!canQuote || !asset || amountBaseUnits === null) {
      setQuote(null);
      return;
    }

    const inputMint = buying ? payWith.mint : asset.mint;
    const outputMint = buying ? asset.mint : receiveIn.mint;

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
  }, [canQuote, asset, buying, payWith, receiveIn, amountBaseUnits, slippageBps]);

  const fee = feeFor(Number.isFinite(amountUsd) ? amountUsd : 0);
  const impactPct = quote ? Math.abs(quote.priceImpactPct * 100) : 0;
  const impactBlocks = impactPct >= 50;
  const impactWarns = impactPct >= 15 && !impactBlocks;

  const fundingSymbol = buying ? payWith.symbol : symbol;

  /*
   * Checked in this order because each one is the more useful thing to say:
   * no signer beats no balance, and "you don't have that much" beats a price
   * impact figure computed for a trade that cannot happen anyway.
   */
  const blockReason = !open
    ? null
    : !canSign
      ? session.mode === "demo"
        ? "Demo mode cannot sign. Add a Privy app id to trade."
        : "Connect a wallet to trade."
      : entered <= 0
        ? null
        : balances.isError
          ? "Could not read your balance, so this trade cannot be checked. Try again in a moment."
          : availableRaw === null
            ? "Checking your balance…"
            : overBalance
              ? overBalanceMessage({
                  buying,
                  solFunded: buying && payWith.symbol === "SOL",
                  available: available ?? 0,
                  symbol: fundingSymbol,
                })
              : shortOnFees
                ? "You need a little SOL for network fees — about 0.003 SOL."
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
    // Buys arrive in the asset; sells in whichever payout was chosen.
    const decimals = buying ? assetDecimals : receiveIn.decimals;
    return Number(quote.outAmount) / 10 ** decimals;
  }, [quote, asset, assetDecimals, buying, receiveIn.decimals]);

  async function confirm() {
    if (!asset || !quote || !wallet || !session.signAndSend) return;
    // The button is disabled for these already; this is the last word, not the
    // first, in case a balance refetch landed between render and press.
    if (blockReason !== null) return;

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

      /*
       * The signature exists from here on, so it is shown from here on.
       *
       * Set before confirmation rather than after, because once the network has
       * the transaction the outcome is no longer ours to decide — and a ticket
       * that shows nothing while it waits is one somebody closes and retries,
       * paying twice for the same trade.
       */
      setSignature(sig);
      setStatus("Confirming on-chain…");

      const outcome = await confirmSignature(sig);
      setStatus(null);

      // Whatever happened, the balances this ticket limits against are now
      // suspect, and so is the portfolio that sent you here.
      void queryClient.invalidateQueries({queryKey: balancesKey(wallet, balanceMints)});
      void queryClient.invalidateQueries({queryKey: ["stonkfolio", wallet]});
      // And your history and cost basis, which now include this trade.
      void queryClient.invalidateQueries({queryKey: [WALLET_TRADES_KEY, wallet]});

      if (outcome === "failed") {
        setError("The transaction was rejected on-chain. Open it to see why.");
      } else if (outcome === "unknown") {
        // Deliberately not an error. It is almost certainly landing, and
        // calling it a failure is how a trade gets sent twice.
        setError(
          "Still confirming. Your transaction was sent — open it to follow along.",
        );
      }
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
                <TokenToggle
                  label="Pay with"
                  value={payWith}
                  onChange={(option) => {
                    setPayWith(option);
                    setAmount("");
                    setQuote(null);
                  }}
                />
              ) : (
                // The amount stays in the coin; only the payout changes, so
                // the typed number is kept.
                <TokenToggle
                  label="Receive"
                  value={receiveIn}
                  onChange={(option) => {
                    setReceiveIn(option);
                    writeSellPayout(option.symbol);
                    setQuote(null);
                  }}
                />
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
                ? `≈ ${units(estimatedOut)} ${buying ? symbol : receiveIn.symbol}`
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
                    // Disabled until there is a position to take a share of —
                    // a "50%" that sizes off nothing is worse than one that
                    // plainly waits.
                    disabled={heldRaw === null || heldRaw <= 0n}
                    onClick={() => {
                      if (heldRaw === null) return;
                      // Written as exact decimal text, so 100% comes back out
                      // of the field as precisely the balance.
                      setAmount(fromBaseUnits(shareOf(heldRaw, step), assetDecimals));
                      setError(null);
                      setSignature(null);
                    }}
                  />
                ))}
          </div>

          {wallet ? (
            <div className="tabular-nums mt-2 flex items-center justify-between gap-3 px-1 text-[12px] font-semibold">
              <span className="text-faint">{buying ? "Available" : "You hold"}</span>
              <span className={cn("truncate font-bold", overBalance ? "text-error" : "text-muted")}>
                {balances.isError
                  ? "Couldn't read balance"
                  : available === null
                    ? "…"
                    : `${amountLabel(available)} ${fundingSymbol}`}
                {buying && payWith.symbol === "SOL" && available !== null
                  ? ` · ${Number(SOL_FEE_RESERVE_LAMPORTS) / 1e9} kept for fees`
                  : ""}
              </span>
            </div>
          ) : null}

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
              receivedSymbol={buying ? symbol : receiveIn.symbol}
              receivedDecimals={buying ? assetDecimals : receiveIn.decimals}
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

function amountLabel(value: number): string {
  return value === 0 ? "0" : units(value);
}

/** Why an amount is more than the wallet can cover, in the unit being typed. */
function overBalanceMessage({
  buying,
  solFunded,
  available,
  symbol,
}: {
  buying: boolean;
  solFunded: boolean;
  available: number;
  symbol: string;
}): string {
  if (!buying) {
    return available === 0
      ? `You don't hold any ${symbol} in this wallet.`
      : `You only hold ${amountLabel(available)} ${symbol}.`;
  }
  if (solFunded) {
    return `You can spend up to ${amountLabel(available)} SOL — a little is kept back for network fees.`;
  }
  return `You only have ${amountLabel(available)} ${symbol}.`;
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
  receivedSymbol,
  receivedDecimals,
  feeUsd,
  slippageBps,
  impactPct,
  impactLevel,
}: {
  quote: QuoteState;
  /** What arrives: the asset on a buy, the chosen payout on a sell. */
  receivedSymbol: string;
  /**
   * The decimals of what is being *received*, decided by the caller.
   *
   * This used to be worked out here and was wrong twice: a hardcoded 6 made a
   * 9-decimal coin's minimum read a thousand times too large, and a SOL payout
   * (9 decimals) would have done the same on a sell.
   */
  receivedDecimals: number;
  feeUsd: number;
  slippageBps: number;
  impactPct: number;
  impactLevel: "ok" | "warn" | "block";
}) {
  const minOut = Number(quote.otherAmountThreshold) / 10 ** receivedDecimals;

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

/** SOL or USDC: what a buy spends, or what a sell pays out. */
function TokenToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: (typeof PAY_WITH)[number];
  onChange: (option: (typeof PAY_WITH)[number]) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]"
      >
        {PAY_WITH.map((option) => {
          const active = option.mint === value.mint;
          return (
            <button
              key={option.mint}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option)}
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
