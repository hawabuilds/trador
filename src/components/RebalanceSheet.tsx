"use client";

import {useEffect, useMemo, useState, type ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";

import {balancesKey, useBalances} from "@/hooks/useBalances";
import {WALLET_TRADES_KEY} from "@/hooks/useWalletTrades";
import {
  assetSymbol,
  planRebalanceWithTargets,
  planTopUp,
  type RebalanceLeg,
} from "@/lib/allocation";
import {txUrl} from "@/config/explorer";
import {cn} from "@/lib/cn";
import {compactMoney} from "@/lib/format";
import {USDC_MINT} from "@/lib/programs";
import {useSession} from "@/lib/session";
import {executeSwap, fetchQuote} from "@/lib/swapFlow";
import type {Pubkey} from "@/lib/pubkey";
import type {Holding} from "@/lib/types";
import {Button} from "./ui/Button";
import {Modal} from "./ui/Modal";

type Mode = "trade" | "topup";
type LegStatus = "pending" | "running" | "done" | "failed" | "skipped";

export function RebalanceSheet({
  open,
  onClose,
  holdings,
  targets,
  wallet,
  slippageBps,
  isDemo,
}: {
  open: boolean;
  onClose: () => void;
  holdings: readonly Holding[];
  targets: Record<string, number>;
  wallet: Pubkey;
  slippageBps: number;
  isDemo: boolean;
}) {
  const session = useSession();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("trade");
  const [topUpAmount, setTopUpAmount] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [legStatus, setLegStatus] = useState<Record<string, LegStatus>>({});

  const plan = useMemo(
    () => planRebalanceWithTargets(holdings, targets),
    [holdings, targets],
  );

  const topUpUsd = useMemo(() => {
    const entered = Number(topUpAmount);
    if (!Number.isFinite(entered) || entered <= 0) return 0;
    return entered;
  }, [topUpAmount]);

  const topUpLegs = useMemo(
    () => (mode === "topup" ? planTopUp(holdings, targets, topUpUsd) : []),
    [mode, holdings, targets, topUpUsd],
  );

  const legs: RebalanceLeg[] = mode === "trade" ? [...plan.sells, ...plan.buys] : topUpLegs;

  const mints = useMemo(() => [USDC_MINT, ...legs.map((leg) => leg.mint)], [legs]);
  useBalances(wallet, mints, open);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setStatus(null);
      setError(null);
      setSignature(null);
      setLegStatus({});
      setSelected({});
    }
  }, [open]);

  const selectedLegs = legs.filter((leg) => {
    const key = legKey(leg);
    if (selected[key] === false) return false;
    if (leg.belowMinimum) return false;
    return true;
  });

  function legKey(leg: RebalanceLeg): string {
    return `${leg.side}:${leg.mint}`;
  }

  function toggleLeg(leg: RebalanceLeg) {
    const key = legKey(leg);
    setSelected((current) => ({...current, [key]: !(current[key] ?? true)}));
  }

  async function execute() {
    if (isDemo || !session.signAndSend) {
      setError("Demo mode cannot sign. Add a Privy app id to trade.");
      return;
    }
    if (selectedLegs.length === 0) {
      setError("Select at least one trade above the minimum size.");
      return;
    }

    setRunning(true);
    setError(null);
    setSignature(null);

    const hub = USDC_MINT;
    let index = 0;

    try {
      for (const leg of selectedLegs) {
        index += 1;
        const key = legKey(leg);
        setLegStatus((current) => ({...current, [key]: "running"}));
        setStatus(
          `${leg.side === "sell" ? "Selling" : "Buying"} ${assetSymbol(leg.asset)} (${index} of ${selectedLegs.length})…`,
        );

        const inputMint = leg.side === "sell" ? leg.mint : hub;
        const outputMint = leg.side === "sell" ? hub : leg.mint;

        const quote = await fetchQuote({
          inputMint,
          outputMint,
          amountBase: leg.amountBase,
          slippageBps,
        });

        const result = await executeSwap({
          quote,
          wallet,
          signAndSend: session.signAndSend,
          onStatus: setStatus,
        });

        setSignature(result.signature);

        if (result.outcome === "failed") {
          setLegStatus((current) => ({...current, [key]: "failed"}));
          throw new Error("The transaction was rejected on-chain.");
        }

        setLegStatus((current) => ({...current, [key]: "done"}));
        void queryClient.invalidateQueries({queryKey: balancesKey(wallet, mints)});
        void queryClient.invalidateQueries({queryKey: ["stonkfolio", wallet]});
      }

      void queryClient.invalidateQueries({queryKey: [WALLET_TRADES_KEY, wallet]});
      setStatus("Rebalance complete.");
    } catch (caught) {
      const message = (caught as Error).message ?? "Rebalance failed.";
      setError(message);
      setStatus(null);
    } finally {
      setRunning(false);
    }
  }

  const canSign = Boolean(session.signAndSend) && !isDemo;

  return (
    <Modal
      open={open}
      onClose={running ? () => {} : onClose}
      title="Rebalance"
      className="max-w-[400px] p-5"
    >
      <div className="mb-3 flex gap-2">
        <ModeChip active={mode === "trade"} onClick={() => setMode("trade")}>
          Buy and sell
        </ModeChip>
        <ModeChip active={mode === "topup"} onClick={() => setMode("topup")}>
          Top up only
        </ModeChip>
      </div>

      {mode === "topup" ? (
        <div className="mb-4 space-y-2">
          <p className="text-[12px] leading-[1.5] text-muted">
            Add USDC to underweight slices. Nothing is sold.
          </p>
          <input
            type="number"
            min={0}
            step={1}
            value={topUpAmount}
            onChange={(event) => setTopUpAmount(event.target.value)}
            placeholder="Amount in USDC"
            className="w-full rounded-xl bg-[var(--segment-track)] px-3 py-2.5 text-[15px] font-bold text-ink shadow-inset-soft"
          />
        </div>
      ) : (
        <p className="mb-3 text-[12px] leading-[1.5] text-muted">
          Overweight holdings sell to USDC, then underweight ones buy from it.
        </p>
      )}

      <ul className="max-h-[min(44vh,320px)] space-y-2 overflow-y-auto">
        {legs.length === 0 ? (
          <li className="py-6 text-center text-[13px] text-muted">
            {mode === "topup"
              ? "Enter an amount to preview top-up buys."
              : "Your holdings already match your targets."}
          </li>
        ) : (
          legs.map((leg) => {
            const key = legKey(leg);
            const checked = selected[key] ?? true;
            const state = legStatus[key] ?? "pending";
            const symbol = assetSymbol(leg.asset);
            return (
              <li
                key={key}
                className={cn(
                  "flex items-start gap-2 rounded-xl px-2.5 py-2",
                  leg.belowMinimum && "opacity-50",
                )}
              >
                {mode === "trade" ? (
                  <input
                    type="checkbox"
                    checked={checked && !leg.belowMinimum}
                    disabled={leg.belowMinimum || running}
                    onChange={() => toggleLeg(leg)}
                    className="mt-1"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-extrabold text-ink">
                      {leg.side === "sell" ? "Sell" : "Buy"} {symbol}
                    </span>
                    <LegBadge status={state} />
                  </div>
                  <div className="tabular-nums text-[12px] font-semibold text-faint">
                    ≈ {compactMoney(leg.amountUsd)}
                    {leg.belowMinimum ? " · below $1 minimum" : ""}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>

      {status ? (
        <p className="mt-3 text-[12px] font-semibold text-muted">{status}</p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[12px] font-semibold text-price-down">{error}</p>
      ) : null}
      {signature ? (
        <a
          href={txUrl(signature)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block truncate text-[12px] font-semibold text-brand-500"
        >
          View last transaction
        </a>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button variant="outline" fullWidth disabled={running} onClick={onClose}>
          {running ? "Working…" : "Close"}
        </Button>
        <Button
          variant="primary"
          fullWidth
          disabled={running || !canSign || selectedLegs.length === 0}
          onClick={() => void execute()}
        >
          {running ? "Rebalancing…" : "Execute rebalance"}
        </Button>
      </div>
    </Modal>
  );
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
        active
          ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
          : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
      )}
    >
      {children}
    </button>
  );
}

function LegBadge({status}: {status: LegStatus}) {
  const label =
    status === "done"
      ? "Done"
      : status === "running"
        ? "…"
        : status === "failed"
          ? "Failed"
          : status === "skipped"
            ? "Skipped"
            : null;
  if (!label) return null;
  return (
    <span className="rounded-full bg-[var(--overlay-wash)] px-1.5 py-0.5 text-[10px] font-bold text-faint">
      {label}
    </span>
  );
}
