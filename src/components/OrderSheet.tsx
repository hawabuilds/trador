"use client";

import {useEffect, useMemo, useState} from "react";

import {FEE_BPS, feeFor, tooSmall} from "@/config/fees";
import {useSession} from "@/lib/session";
import {cn} from "@/lib/cn";
import {formatPriceUsd} from "@/lib/priceState";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import type {Asset} from "@/lib/types";
import {Button} from "./ui/Button";
import {Sheet, SheetFooter, SheetTitle} from "./ui/Sheet";

/** What a buy is funded with. Sells always go back to USDC. */
const PAY_WITH = [
  {mint: WSOL_MINT, symbol: "SOL", decimals: 9},
  {mint: USDC_MINT, symbol: "USDC", decimals: 6},
] as const;

const PRESETS_USD = [10, 25, 100];

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

  const [payWith, setPayWith] = useState<(typeof PAY_WITH)[number]>(PAY_WITH[0]);
  const [amountUsd, setAmountUsd] = useState<number>(25);
  const [slippageBps, setSlippageBps] = useState(100);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const open = asset !== null;
  const symbol = asset?.kind === "stock" ? asset.ticker : (asset?.symbol ?? "");

  // Reset when the ticket opens on a different asset or side, so a previous
  // quote or error cannot bleed into a new order.
  useEffect(() => {
    setQuote(null);
    setError(null);
    setStatus(null);
    setSignature(null);
  }, [asset?.id, side]);

  const priceUsd = asset?.price.usd ?? null;

  /**
   * The input amount in base units.
   *
   * A buy is sized in dollars of the funding token; a sell in units of the
   * asset, derived from the dollar figure at the current price. Sizing a sell
   * in dollars directly would need a price the sheet may not have.
   */
  const amountBaseUnits = useMemo(() => {
    if (!asset) return null;

    if (side === "buy") {
      // Funding token price is needed to convert dollars into its base units.
      // USDC is a dollar; SOL is not, so it needs the live SOL price, which
      // this sheet does not have — so SOL buys are sized in SOL directly.
      if (payWith.symbol === "USDC") {
        return String(Math.round(amountUsd * 10 ** payWith.decimals));
      }
      return null;
    }

    if (priceUsd === null || priceUsd <= 0) return null;
    const decimals = asset.kind === "stonk" ? (asset.decimals ?? 6) : asset.decimals;
    const units = amountUsd / priceUsd;
    return String(Math.round(units * 10 ** decimals));
  }, [asset, side, payWith, amountUsd, priceUsd]);

  const canQuote =
    open && amountBaseUnits !== null && !tooSmall(amountUsd) && asset !== null;

  useEffect(() => {
    if (!canQuote || !asset || amountBaseUnits === null) {
      setQuote(null);
      return;
    }

    const inputMint = side === "buy" ? payWith.mint : asset.mint;
    const outputMint = side === "buy" ? asset.mint : USDC_MINT;

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
  }, [canQuote, asset, side, payWith, amountBaseUnits, slippageBps]);

  const fee = feeFor(amountUsd);
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
      : tooSmall(amountUsd)
        ? `Minimum trade is $${1}.`
        : amountBaseUnits === null
          ? side === "buy"
            ? "Pay with USDC to size this in dollars."
            : "No price yet, so this cannot be sized."
          : impactBlocks
            ? `Price impact is ${impactPct.toFixed(1)}% — too high to place.`
            : null;

  async function submit() {
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
      setError(/reject|denied|cancel/i.test(message) ? "You cancelled the signature." : message);
      setStatus(null);
    }
  }

  if (!asset) return null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="90%"
      label={`${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
      header={
        <SheetTitle
          title={`${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
          onClose={onClose}
        />
      }
      footer={
        <SheetFooter columns={1}>
          {signature ? (
            <Button variant="green" fullWidth onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button
              variant={side === "buy" ? "green" : "dark"}
              fullWidth
              disabled={blockReason !== null || quote === null || status !== null}
              onClick={() => void submit()}
            >
              {status ?? (side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`)}
            </Button>
          )}
        </SheetFooter>
      }
    >
      <div className="pb-2">
        {side === "buy" ? (
          <div className="mb-4">
            <Label>Pay with</Label>
            <div className="flex gap-2">
              {PAY_WITH.map((option) => (
                <button
                  key={option.mint}
                  type="button"
                  onClick={() => setPayWith(option)}
                  aria-pressed={payWith.mint === option.mint}
                  className={cn(
                    "flex-1 rounded-[12px] py-2.5 text-[13.5px] font-extrabold transition-colors",
                    payWith.mint === option.mint
                      ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                      : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
                  )}
                >
                  {option.symbol}
                </button>
              ))}
            </div>
            {payWith.symbol === "SOL" ? (
              <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
                Sizing in dollars needs a SOL price this sheet does not hold yet.
                Pay with USDC to size by amount.
              </p>
            ) : null}
          </div>
        ) : null}

        <Label>{side === "buy" ? "Amount" : "Sell about"}</Label>
        <div className="tabular-nums text-[34px] font-extrabold leading-none tracking-[-0.035em]">
          ${amountUsd}
        </div>

        <div className="mt-3 flex gap-2">
          {PRESETS_USD.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmountUsd(preset)}
              aria-pressed={amountUsd === preset}
              className={cn(
                "flex-1 rounded-full py-2 text-[13px] font-extrabold transition-colors",
                amountUsd === preset
                  ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                  : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
              )}
            >
              ${preset}
            </button>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl bg-surface-card shadow-card">
          <Row label="Price">{formatPriceUsd(priceUsd)}</Row>
          <Row label="Route">
            {quoting ? "…" : quote?.routeLabels.length ? quote.routeLabels.join(" → ") : "—"}
          </Row>
          <Row label={`Trador fee (${FEE_BPS / 100}%)`}>
            {/* Only claimed when the router actually priced one in. */}
            {quote?.platformFee ? `$${fee.usd.toFixed(2)}` : "None"}
          </Row>
          <Row label="Price impact" tone={impactBlocks ? "down" : impactWarns ? "warn" : undefined}>
            {quote ? `${impactPct.toFixed(2)}%` : "—"}
          </Row>
          <Row label="Max slippage">
            <div className="flex gap-1">
              {[50, 100, 300].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => setSlippageBps(bps)}
                  aria-pressed={slippageBps === bps}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11.5px] font-extrabold transition-colors",
                    slippageBps === bps
                      ? "bg-[var(--bg-input)] text-ink"
                      : "text-faint hover:text-muted",
                  )}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </Row>
        </div>

        {signature ? (
          <p className="mt-4 text-[12.5px] font-semibold leading-[1.5] text-price-up">
            Sent. Signature {signature.slice(0, 8)}…{signature.slice(-6)}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-[12.5px] font-semibold leading-[1.5] text-price-down">
            {error}
          </p>
        ) : null}

        {blockReason && !error ? (
          <p className="mt-4 text-[12.5px] font-semibold leading-[1.5] text-faint">
            {blockReason}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function Label({children}: {children: React.ReactNode}) {
  return (
    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
      {children}
    </div>
  );
}

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "down" | "warn";
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 even:bg-[var(--overlay-wash)]/40">
      <span className="text-[12.5px] font-bold text-faint">{label}</span>
      <span
        className={cn(
          "tabular-nums text-right text-[13px] font-extrabold",
          tone === "down" && "text-price-down",
          tone === "warn" && "text-warning",
        )}
      >
        {children}
      </span>
    </div>
  );
}
