"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {useQuery, useQueryClient} from "@tanstack/react-query";

import {FEE_BPS, tooSmall} from "@/config/fees";
import {balancesKey, useBalances} from "@/hooks/useBalances";
import {WALLET_TRADES_KEY} from "@/hooks/useWalletTrades";
import {
  SOL_FEE_RESERVE_LAMPORTS,
  baseUnitsToScaled,
  fromBaseUnits,
  scaledToBaseUnits,
  shareOf,
  spendableLamports,
  toBaseUnits,
} from "@/lib/amounts";
import {confirmSignature} from "@/lib/confirmSignature";
import {
  MIN_FEE_LAMPORTS,
  MONEY,
  SOL,
  USDC,
  type SettleMint,
  moneyReceived,
  overBalanceMessage,
  shortOfNetworkFees,
  spendableBalance,
} from "@/lib/orderMoney";
import {txUrl} from "@/config/explorer";
import {useSession} from "@/lib/session";
import {stockForMint} from "@/lib/stocks/registry";
import {cn} from "@/lib/cn";
import {units} from "@/lib/format";
import {formatPriceUsd} from "@/lib/priceState";
import {readSlippageBps, writeSlippageBps} from "@/lib/localStore";
import type {Asset} from "@/lib/types";
import {Modal} from "./ui/Modal";
import {SettingsIcon} from "./ui/Icons";



/**
 * Where the registry stops calling a stock tradable, and where this ticket
 * starts saying the price is worse than it looks. One number, so the screen
 * that admits a stock and the warning in front of a trade cannot drift apart.
 */
const TRADABLE_IMPACT_PCT = 2;

/** Preset sizes, in the money being spent. A dollar of USDC is a dollar. */
const QUICK_SOL = [0.05, 0.25, 1];
const QUICK_USDC = [10, 25, 100];
/** Sell sizes, as a share of the position. 100 sells the exact balance. */
const SELL_STEPS = [25, 50, 75, 100];

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
 * The fee, exactly as the server charged it.
 *
 * Not recomputed here, and deliberately not derivable from anything on this
 * screen. Which leg the fee comes out of is a server decision, and the router's
 * own figure is in the wrong mint on buys, so a number worked out in the
 * browser would disagree with the transaction being signed.
 */
interface FeeState {
  /** Base units of `mint`. */
  amount: string;
  mint: string;
  symbol: string;
  decimals: number;
  side: "input" | "output";
  bps: number;
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
  onReceive,
}: {
  asset: Asset | null;
  side: "buy" | "sell";
  onClose: () => void;
  /** Opens receive flow when the wallet needs SOL for fees or a SOL-funded buy. */
  onReceive?: () => void;
}) {
  const session = useSession();
  const queryClient = useQueryClient();

  const [activeSide, setActiveSide] = useState<"buy" | "sell">(side);
  /*
   * Which money the trade settles in, remembered while the ticket is open.
   *
   * Deliberately not reset when the side flips: someone who chose to deal in
   * USDC meant it for this coin, not for this one press of Buy.
   */
  const [settleMint, setSettleMint] = useState<SettleMint>("sol");
  const [amount, setAmountText] = useState("");
  /*
   * Set only by the 100% button, and cleared the moment anything else moves.
   *
   * "All of it" is the balance, not the number that was printed in the field
   * for it — printing rounds down, and a sell that leaves a few base units
   * behind reads as the app having kept something back.
   */
  const [sellAll, setSellAll] = useState(false);

  /** Typing, clearing or picking a preset is always an amount of its own. */
  const setAmount = useCallback((next: string) => {
    setSellAll(false);
    setAmountText(next);
  }, []);
  const [slippageBps, setSlippageBps] = useState(100);
  const [configOpen, setConfigOpen] = useState(false);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [fee, setFee] = useState<FeeState | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const open = asset !== null;
  const buying = activeSide === "buy";
  /** The money this trade is paid in or out of. */
  const money = MONEY[settleMint];
  const symbol = asset?.kind === "stock" ? asset.ticker : (asset?.symbol ?? "");

  // Slippage is a browser preference, not an order field: someone who set 3%
  // once meant it for their trading, not for one ticket.
  useEffect(() => {
    setSlippageBps(readSlippageBps(100));
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
    setSettleMint("sol");
    setAmount("");
    setQuote(null);
    setFee(null);
    setError(null);
    setStatus(null);
    setSignature(null);
    setConfigOpen(false);
    // `setAmount` is stable, but it is a callback now rather than a setter, so
    // the linter wants to see it.
  }, [asset?.id, setAmount, side]);

  const wallet = session.user?.wallet ?? null;
  const canSign = session.signAndSend !== null && wallet !== null;

  /*
   * What the wallet actually holds of this asset and its SOL.
   *
   * The ticket used to know none of this, so it could not offer a size as a
   * share of a position, had no "sell all", and would happily ask you to sign
   * a trade for more than you own — which then failed in simulation.
   */
  /*
   * The asset's balance is read on both sides.
   *
   * A sell needs its exact base units to size against. A buy needs the mint's
   * scaled multiplier, which travels with the balance: on a mint that is
   * scaled ten to one, the tokens arriving are ten times the raw figure, and
   * an estimate that says otherwise is off by that much.
   */
  const balanceMints = useMemo(
    () => (asset ? [asset.mint, USDC.mint] : []),
    [asset],
  );
  const balances = useBalances(wallet, balanceMints, open && wallet !== null);
  const held = asset ? balances.data?.tokens[asset.mint] : undefined;
  const heldRaw = balances.data ? BigInt(held?.amount ?? "0") : null;
  const lamports = balances.data ? BigInt(balances.data.lamports) : null;
  /** Real USDC, read from the wallet rather than inferred from a dollar value. */
  const usdcRaw = balances.data
    ? BigInt(balances.data.tokens[USDC.mint]?.amount ?? "0")
    : null;

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

  /**
   * What one base unit of this asset is worth in tokens.
   *
   * Everything on this ticket is typed, shown and quoted in tokens; only the
   * transaction is in base units. This is the one place the two meet.
   */
  const multiplier = held?.multiplier ?? 1;

  /*
   * Some mints take a cut of every transfer, including each leg of a swap.
   * Read from the registry, where it was recorded off the mint account rather
   * than assumed per issuer.
   */
  const assetTransferFeeBps = asset ? (stockForMint(asset.mint)?.transferFeeBps ?? null) : null;

  const priceUsd = asset?.price.usd ?? null;
  const typed = Number.parseFloat(amount);
  const entered = Number.isFinite(typed) && typed > 0 ? typed : 0;

  /*
   * A SOL price is only needed to turn a SOL amount into the dollar figure
   * printed beside it. A trade settled in USDC never needs one, which is also
   * why a USDC buy keeps working when the price feed is down.
   */
  const needsSolUsd = open && buying && settleMint === "sol";

  const solUsdQuery = useQuery({
    queryKey: ["sol-usd"],
    enabled: needsSolUsd,
    staleTime: 30_000,
    refetchInterval: needsSolUsd ? 60_000 : false,
    queryFn: async (): Promise<number | null> => {
      const response = await fetch("/api/sol-usd");
      const body = (await response.json()) as {usd?: number | null; error?: string};
      if (!response.ok) throw new Error(body.error ?? "Could not read SOL price.");
      return body.usd ?? null;
    },
  });
  const solUsd = solUsdQuery.data ?? null;

  /**
   * What one unit of the settlement currency is worth.
   *
   * A dollar for USDC, by definition rather than by lookup. Treating it as a
   * dollar is what lets a USDC trade be sized, checked and quoted without a
   * price feed in the way.
   */
  const moneyUsd = settleMint === "usdc" ? 1 : solUsd;

  /** Dollar value of the trade, when it can be derived. */
  const amountUsd = useMemo(() => {
    if (buying) {
      return moneyUsd !== null && moneyUsd > 0 ? entered * moneyUsd : Number.NaN;
    }
    return priceUsd !== null && priceUsd > 0 ? entered * priceUsd : Number.NaN;
  }, [buying, entered, moneyUsd, priceUsd]);

  /**
   * Base units sent to the router: the money on a buy, the asset on a sell.
   */
  const amountRaw = useMemo(() => {
    if (!asset || entered <= 0) return null;

    if (buying) {
      const parsed = toBaseUnits(amount, money.decimals);
      return parsed !== null && parsed > 0n ? parsed : null;
    }

    // Selling the lot sends the balance itself, not a number typed back in:
    // a round trip through text can only ever lose base units, and leaving
    // dust behind on "100%" is the thing people notice.
    if (sellAll && heldRaw !== null && heldRaw > 0n) return heldRaw;
    const parsed = scaledToBaseUnits(amount, assetDecimals, multiplier);
    return parsed !== null && parsed > 0n ? parsed : null;
  }, [
    asset,
    amount,
    assetDecimals,
    buying,
    entered,
    heldRaw,
    money.decimals,
    multiplier,
    sellAll,
  ]);

  const amountBaseUnits = amountRaw === null ? null : amountRaw.toString();

  /**
   * The most this side can spend, in the unit being typed.
   *
   * SOL keeps a little back for network fees because the same balance has to
   * pay for the transaction. USDC does not: it is spent in full, and the SOL
   * needed for fees is checked separately.
   */
  const availableRaw = spendableBalance({
    buying,
    settleMint,
    lamports,
    usdc: usdcRaw,
    held: heldRaw,
  });
  const availableDecimals = buying ? money.decimals : assetDecimals;
  const available =
    availableRaw === null
      ? null
      : Number(
          buying
            ? fromBaseUnits(availableRaw, availableDecimals)
            : baseUnitsToScaled(availableRaw, availableDecimals, multiplier),
        );
  const overBalance =
    amountRaw !== null &&
    availableRaw !== null &&
    (buying ? amountRaw > availableRaw : amountRaw > availableRaw);
  /*
   * Every trade needs SOL for its network fee, whatever it is funded in. A USDC
   * buy from a wallet with no SOL fails at signing, so it is caught here.
   */
  const shortOnFees = shortOfNetworkFees({buying, settleMint, lamports});

  const insufficientSol = useMemo(() => {
    if (!open || lamports === null || entered <= 0) return null;
    const balance = fromBaseUnits(lamports, 9);

    if (buying && settleMint === "sol") {
      const spendable = spendableLamports(lamports);
      if (overBalance || (amountRaw !== null && amountRaw > spendable) || spendable <= 0n) {
        return {
          balance,
          detail:
            spendable > 0n
              ? `${fromBaseUnits(spendable, 9)} SOL available after fees`
              : undefined,
        };
      }
    }

    if (shortOnFees) {
      return {
        balance,
        detail: "About 0.003 SOL is needed for network fees",
      };
    }

    return null;
  }, [open, lamports, entered, buying, amountRaw, overBalance, settleMint, shortOnFees]);

  const undersized =
    entered > 0 && Number.isFinite(amountUsd) && tooSmall(amountUsd);

  const canQuote = open && amountBaseUnits !== null && !undersized;

  useEffect(() => {
    if (!canQuote || !asset || amountBaseUnits === null) {
      setQuote(null);
      setFee(null);
      return;
    }

    const inputMint = buying ? money.mint : asset.mint;
    const outputMint = buying ? asset.mint : money.mint;

    let cancelled = false;
    setQuoting(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
            `&amount=${amountBaseUnits}&slippageBps=${slippageBps}`,
        );
        const body = (await response.json()) as {
          quote?: QuoteState;
          fee?: FeeState | null;
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.quote) {
          setQuote(null);
          setFee(null);
          setError(body.error ?? "Could not price this trade.");
          return;
        }
        setQuote(body.quote);
        setFee(body.fee ?? null);
      } catch {
        if (!cancelled) setError("Could not reach the router.");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canQuote, asset, buying, amountBaseUnits, money.mint, slippageBps]);

  const impactPct = quote ? Math.abs(quote.priceImpactPct * 100) : 0;
  const impactBlocks = impactPct >= 50;
  const impactWarns = impactPct >= 15 && !impactBlocks;
  /*
   * Two percent is where the registry stops calling a stock tradable, so it is
   * where the ticket starts saying so. Below the 15% warning on purpose: at 3%
   * the price is worse than quoted and the trade is still reasonable, and a
   * red alert on every thin pool is one people learn to click past.
   */
  const impactCautions = impactPct >= TRADABLE_IMPACT_PCT && !impactWarns && !impactBlocks;

  const fundingSymbol = buying ? money.symbol : symbol;
  /** Preset sizes in the money being spent: SOL is small, dollars are not. */
  const quickSizes = settleMint === "usdc" ? QUICK_USDC : QUICK_SOL;
  /** What a buy actually spends, in the money it spends it in. */
  const execMoney =
    buying && amountRaw !== null
      ? Number(fromBaseUnits(amountRaw, money.decimals))
      : null;

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
            : insufficientSol
              ? null
              : overBalance
                ? overBalanceMessage({
                    buying,
                    available: available ?? 0,
                    symbol: fundingSymbol,
                    reserved: buying && settleMint === "sol",
                    format: amountLabel,
                  })
                : undersized
                  ? "Minimum trade is $1."
                  : needsSolUsd && solUsdQuery.isLoading
                    ? "Checking SOL price…"
                    : needsSolUsd && solUsdQuery.isError
                      ? "Could not read SOL price. Try again in a moment."
                      : needsSolUsd && (solUsd === null || solUsd <= 0)
                        ? "Could not read the SOL price. Try again in a moment."
                        : impactBlocks
                      ? `Price impact is ${impactPct.toFixed(1)}% — too high to place.`
                      : null;

  /** What the confirm button receives, in the unit it will actually arrive in. */
  const estimatedOut = useMemo(() => {
    if (!quote || !asset) return null;
    if (!buying) return moneyReceived(quote.outAmount, money);
    return Number(baseUnitsToScaled(BigInt(quote.outAmount), assetDecimals, multiplier));
  }, [quote, asset, assetDecimals, buying, money, multiplier]);

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
        simulationLogs?: string[];
      };

      if (!response.ok || !body.swap) {
        const detail =
          body.error ??
          (body.simulationLogs?.length
            ? body.simulationLogs.slice(-2).join(" ")
            : undefined);
        throw new Error(detail ?? "Could not build the transaction.");
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
    insufficientSol !== null ||
    quote === null ||
    status !== null ||
    entered <= 0 ||
    signature !== null;

  /** What the number in the field is counted in. */
  const unit = buying ? money.symbol : symbol;

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
                    setFee(null);
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
            Amount in {unit}
          </label>
          <div className="rounded-2xl bg-[var(--bg-input)] px-4 py-3.5 shadow-inset-soft transition-[box-shadow,background-color] focus-within:shadow-inset-focus">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
                Amount
              </span>
              <MoneyToggle
                buying={buying}
                value={settleMint}
                onChange={(next) => {
                  if (next === settleMint) return;
                  setSettleMint(next);
                  setAmount("");
                  setQuote(null);
                  setFee(null);
                  setError(null);
                  setSignature(null);
                }}
              />
            </div>

            <div className="flex items-baseline gap-1.5">
              <input
                id="order-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^0-9.]/g, "");
                  const parts = next.split(".");
                  // Dollars are typed to the cent; everything else to six.
                  const places = buying && settleMint === "usdc" ? 2 : 6;
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
              <span className="text-[15px] font-extrabold text-faint">{unit}</span>
            </div>

            <div className="tabular-nums mt-1 text-[12px] font-semibold text-faint">
              {quote && estimatedOut !== null
                ? `≈ ${units(estimatedOut)} ${buying ? symbol : money.symbol}`
                : quoting && entered > 0
                  ? "Finding route…"
                  : `${formatPriceUsd(priceUsd)} per ${symbol}`}
            </div>
          </div>

          <div className="mt-2.5 flex gap-2">
            {buying
              ? quickSizes.map((value) => (
                  <QuickButton
                    key={value}
                    label={`${value} ${money.symbol}`}
                    onClick={() => setAmount(String(value))}
                  />
                ))
              : SELL_STEPS.map((step) => (
                  <QuickButton
                    key={step}
                    label={`${step}%`}
                    disabled={heldRaw === null || heldRaw <= 0n}
                    onClick={() => {
                      if (heldRaw === null) return;
                      const part = shareOf(heldRaw, step);
                      setAmount(baseUnitsToScaled(part, assetDecimals, multiplier));
                      setSellAll(step === 100);
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
                    : `${amountLabel(available)} ${buying ? money.symbol : symbol}`}
                {buying && settleMint === "sol" && available !== null
                  ? `\u00a0\u00a0${Number(SOL_FEE_RESERVE_LAMPORTS) / 1e9} kept for fees`
                  : ""}
              </span>
            </div>
          ) : null}

          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-2.5 text-[12.5px] font-semibold shadow-inset-soft">
            <span className="text-faint">{buying ? "Paying with" : "Selling"}</span>
            <span className="tabular-nums truncate font-extrabold">
              {buying
                ? entered > 0
                  ? execMoney !== null
                    ? `${units(execMoney)} ${money.symbol}`
                    : `${units(entered)} ${unit}`
                  : `— ${money.symbol}`
                : entered > 0
                  ? `${units(entered)} ${unit}`
                  : `— ${unit}`}
              {Number.isFinite(amountUsd) && amountUsd > 0
                ? `\u00a0\u00a0$${amountUsd.toFixed(2)}`
                : ""}
            </span>
          </div>

          {quote ? (
            <TicketBreakdown
              quote={quote}
              receivedSymbol={buying ? symbol : money.symbol}
              receivedDecimals={buying ? assetDecimals : money.decimals}
              receivedMultiplier={buying ? multiplier : 1}
              fee={fee}
              slippageBps={slippageBps}
              impactPct={impactPct}
              impactLevel={
                impactBlocks ? "block" : impactWarns ? "warn" : impactCautions ? "caution" : "ok"
              }
              transferFeeBps={assetTransferFeeBps}
            />
          ) : null}

          {impactWarns && !impactBlocks ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              Price impact is {impactPct.toFixed(1)}%. You would receive
              materially less than the quoted price.
            </p>
          ) : null}

          {impactCautions ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-[var(--warning)]">
              Price impact is {impactPct.toFixed(1)}%. This pool is thin, so you
              pay more than the price shown.
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

          {insufficientSol && !error ? (
            <div className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-3 shadow-inset-soft">
              <p className="text-[12.5px] font-extrabold text-ink">Not enough SOL</p>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">
                You have {insufficientSol.balance} SOL
                {insufficientSol.detail ? `\u00a0\u00a0${insufficientSol.detail}` : ""}
              </p>
              {onReceive ? (
                <button
                  type="button"
                  onClick={onReceive}
                  className="mt-2.5 w-full rounded-full bg-[var(--overlay-wash)] py-2 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
                >
                  Receive
                </button>
              ) : null}
            </div>
          ) : null}

          {blockReason && !error && !insufficientSol ? (
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
            Max slippage {slippageBps / 100}%&nbsp;&nbsp;&nbsp;One signature, no approval step
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
/**
 * What the trade actually costs, line by line.
 *
 * Every row is either a number the router returned or an em dash. Nothing here
 * is estimated locally and presented as if it came from the quote — the fee row
 * in particular prints the server's own figure and mint, because claiming a fee
 * the router did not take, or naming the wrong token for one it did, is the
 * kind of error nobody would ever catch.
 */
function TicketBreakdown({
  quote,
  receivedSymbol,
  receivedDecimals,
  receivedMultiplier,
  fee,
  slippageBps,
  impactPct,
  impactLevel,
  transferFeeBps,
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
  /** Scaled mints report fewer base units than tokens — see `baseUnitsToScaled`. */
  receivedMultiplier: number;
  /** What the server charged, or null when it charged nothing. */
  fee: FeeState | null;
  slippageBps: number;
  impactPct: number;
  impactLevel: "ok" | "caution" | "warn" | "block";
  /** The mint's own transfer fee, charged by the token on top of everything here. */
  transferFeeBps: number | null;
}) {
  const minOut = Number(
    baseUnitsToScaled(BigInt(quote.otherAmountThreshold), receivedDecimals, receivedMultiplier),
  );

  return (
    <div className="mt-2.5 space-y-1 px-1 text-[12px] font-semibold">
      <Line label={`Trador fee (${(fee?.bps ?? FEE_BPS) / 100}%)`}>
        {fee
          ? `${units(Number(fromBaseUnits(BigInt(fee.amount), fee.decimals)))} ${fee.symbol}`
          : "Not taken"}
      </Line>
      <Line
        label="Price impact"
        tone={impactLevel === "ok" ? undefined : impactLevel === "caution" ? "caution" : "error"}
      >
        {impactPct.toFixed(2)}%
      </Line>
      {/*
        The token's own fee, which Trador neither sets nor receives.
        PreStocks charges 1% on OPENAI and Tessera 0.2%, taken by the mint on
        every transfer — including each leg of this swap. A ticket that shows
        only Trador's fee understates what the trade costs by a figure the
        person has no way to look up.
      */}
      {transferFeeBps ? (
        <Line label={`Token transfer fee (${transferFeeBps / 100}%)`}>Charged by the token</Line>
      ) : null}
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
  tone?: "error" | "caution";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-faint">{label}</span>
      <span
        className={cn(
          "tabular-nums truncate font-bold",
          tone === "error"
            ? "text-error"
            : tone === "caution"
              ? "text-[var(--warning)]"
              : "text-muted",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * Which money the trade is settled in.
 *
 * Two pills in the corner of the Amount card, where the typing-unit toggle used
 * to sit — reused rather than joined by a second control, because a ticket this
 * small cannot carry two groups of pills in the same corner.
 *
 * On a sell the pair is introduced by the word "Receive", because the same
 * choice means something different on each side: on a buy it is what leaves the
 * wallet, on a sell it is what arrives. Saying so costs one word and removes
 * the only ambiguity in the control.
 *
 * It also decides what the number in the field is counted in, which is why
 * changing it clears the amount: 0.25 SOL and 0.25 USDC are not the same trade.
 */
function MoneyToggle({
  buying,
  value,
  onChange,
}: {
  buying: boolean;
  value: SettleMint;
  onChange: (next: SettleMint) => void;
}) {
  const options: {id: SettleMint; label: string}[] = [
    {id: "usdc", label: USDC.symbol},
    {id: "sol", label: SOL.symbol},
  ];

  return (
    <div
      role="group"
      aria-label={buying ? "Pay with" : "Receive in"}
      className="flex items-center gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]"
    >
      {buying ? null : (
        <span className="px-1.5 text-[10.5px] font-extrabold text-faint">Receive</span>
      )}
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "tabular-nums max-w-[4.5rem] truncate rounded-full px-2 py-1 text-[10.5px] font-extrabold transition-colors",
              active
                ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                : "text-faint hover:text-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
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
