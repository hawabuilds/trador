"use client";

import {useEffect, useMemo, useState} from "react";

import {Button} from "@/components/ui/Button";
import {SegmentedToggle} from "@/components/ui/SegmentedToggle";
import {Sheet, SheetFooter, SheetTitle} from "@/components/ui/Sheet";
import {isMoonPayEnabled} from "@/config/moonpay";
import {useMoonPay} from "@/hooks/useMoonPay";
import {fromBaseUnits, toBaseUnits} from "@/lib/amounts";
import {cn} from "@/lib/cn";
import {fetchQuote} from "@/lib/swapFlow";
import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {shortPubkey, type Pubkey} from "@/lib/pubkey";

const USD_PRESETS = [25, 50, 100, 250] as const;

type AmountUnit = "usd" | "sol";

const inputClass =
  "w-full rounded-2xl bg-[var(--bg-input)] px-3.5 py-3 text-[14px] font-medium text-ink shadow-inset-soft outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:shadow-inset-focus";

export function DepositSheet({
  open,
  onClose,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  wallet: Pubkey;
}) {
  const moonpay = useMoonPay();
  const [unit, setUnit] = useState<AmountUnit>("usd");
  const [amountText, setAmountText] = useState("50");
  const [counterEstimate, setCounterEstimate] = useState<string | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedUsd = useMemo(() => {
    const n = Number(amountText);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amountText]);

  const parsedSolLamports = useMemo(() => toBaseUnits(amountText, 9), [amountText]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setEstimateError(null);
      setUnit("usd");
      setAmountText("50");
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (unit === "usd") {
            if (parsedUsd === null) {
              setCounterEstimate(null);
              return;
            }
            const quote = await fetchQuote({
              inputMint: USDC_MINT,
              outputMint: WSOL_MINT,
              amountBase: BigInt(Math.round(parsedUsd * 1_000_000)).toString(),
              slippageBps: 100,
            });
            if (cancelled) return;
            setCounterEstimate(fromBaseUnits(BigInt(quote.outAmount), 9));
          } else {
            if (parsedSolLamports === null || parsedSolLamports <= 0n) {
              setCounterEstimate(null);
              return;
            }
            const quote = await fetchQuote({
              inputMint: WSOL_MINT,
              outputMint: USDC_MINT,
              amountBase: parsedSolLamports.toString(),
              slippageBps: 100,
            });
            if (cancelled) return;
            const usdc = Number(quote.outAmount) / 1_000_000;
            setCounterEstimate(usdc.toFixed(2));
          }
          setEstimateError(null);
        } catch (err) {
          if (cancelled) return;
          setCounterEstimate(null);
          setEstimateError((err as Error).message);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, unit, parsedUsd, parsedSolLamports]);

  const canContinue =
    unit === "usd" ? parsedUsd !== null : parsedSolLamports !== null && parsedSolLamports > 0n;

  const heroSecondary =
    unit === "usd"
      ? counterEstimate
        ? `≈ ${counterEstimate} SOL`
        : estimateError
          ? "Could not estimate SOL"
          : "Estimating…"
      : counterEstimate
        ? `≈ $${counterEstimate}`
        : estimateError
          ? "Could not estimate USD"
          : "Estimating…";

  async function continueToMoonPay() {
    if (!isMoonPayEnabled) {
      setError("MoonPay is not configured on this deployment.");
      return;
    }
    if (!canContinue) return;

    setBusy(true);
    setError(null);
    try {
      if (unit === "usd" && parsedUsd !== null) {
        await moonpay.buySol(wallet, {baseCurrencyAmount: String(parsedUsd)});
      } else if (parsedSolLamports !== null) {
        await moonpay.buySol(wallet, {
          quoteCurrencyAmount: fromBaseUnits(parsedSolLamports, 9),
        });
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function switchUnit(next: AmountUnit) {
    setUnit(next);
    setAmountText(next === "usd" ? "50" : "0.1");
    setCounterEstimate(null);
    setEstimateError(null);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Buy crypto"
      header={<SheetTitle title="Buy crypto" onClose={onClose} />}
      footer={
        <SheetFooter columns={1}>
          <Button
            fullWidth
            disabled={busy || moonpay.loading || !canContinue}
            onClick={() => void continueToMoonPay()}
          >
            {busy || moonpay.loading ? "Opening MoonPay…" : "Continue"}
          </Button>
        </SheetFooter>
      }
    >
      <div className="flex flex-col gap-3.5 pb-2 pt-1">
        <SegmentedToggle
          options={[
            {value: "usd", label: "USD"},
            {value: "sol", label: "SOL"},
          ]}
          value={unit}
          onChange={switchUnit}
        />

        <div className="rounded-2xl bg-[var(--segment-track)] px-4 py-5 text-center shadow-inset-soft">
          <div className="tabular-nums text-[36px] font-extrabold leading-none tracking-[-0.04em] text-ink">
            {unit === "usd" ? `$${parsedUsd !== null ? amountText : "0"}` : `${amountText || "0"} SOL`}
          </div>
          <div className="tabular-nums mt-2 text-[13px] font-semibold text-muted">{heroSecondary}</div>
        </div>

        <div>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
            {unit === "usd" ? "Amount in USD" : "Amount in SOL"}
          </label>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            placeholder={unit === "usd" ? "50" : "0.1"}
            className={cn("tabular-nums text-[18px] font-extrabold", inputClass)}
          />
        </div>

        {unit === "usd" ? (
          <div className="grid grid-cols-4 gap-2">
            {USD_PRESETS.map((preset) => {
              const active = parsedUsd === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmountText(String(preset))}
                  className={cn(
                    "tabular-nums rounded-full py-2.5 text-[12px] font-bold transition-colors",
                    active
                      ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                      : "bg-[var(--overlay-wash)] text-ink hover:bg-[var(--overlay-wash-hover)]",
                  )}
                >
                  ${preset}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-2.5 text-[12.5px] font-semibold shadow-inset-soft">
          <span className="text-faint">Receive</span>
          <span className="font-extrabold text-ink">SOL</span>
        </div>

        <p className="text-center text-[11px] font-medium leading-[1.5] text-faint">
          Powered by MoonPay · Funds arrive in {shortPubkey(wallet, 5, 5)}
        </p>

        {error ? (
          <p role="alert" className="text-[12.5px] font-semibold text-price-down">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
