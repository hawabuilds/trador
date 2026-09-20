"use client";

import {useEffect, useMemo, useState} from "react";

import {
  assetSymbol,
  equalTargets,
  pricedHoldings,
  targetsFromActual,
  targetsValid,
} from "@/lib/allocation";
import {cn} from "@/lib/cn";
import type {Holding} from "@/lib/types";
import {Button} from "./ui/Button";
import {Modal} from "./ui/Modal";

export function EditTargetsSheet({
  open,
  onClose,
  holdings,
  initialTargets,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  holdings: readonly Holding[];
  initialTargets: Record<string, number>;
  onSave: (targets: Record<string, number>) => void;
}) {
  const priced = useMemo(() => pricedHoldings(holdings), [holdings]);
  const mints = useMemo(() => priced.map((holding) => holding.asset.mint), [priced]);

  const [draft, setDraft] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    if (Object.keys(initialTargets).length > 0) {
      setDraft(initialTargets);
      return;
    }
    setDraft(targetsFromActual(holdings));
  }, [open, holdings, initialTargets]);

  const total = useMemo(
    () => mints.reduce((sum, mint) => sum + (draft[mint] ?? 0), 0),
    [draft, mints],
  );
  const valid = targetsValid(draft);

  function setWeight(mint: string, next: number) {
    setDraft((current) => ({...current, [mint]: Math.max(0, Math.min(100, next))}));
  }

  function save() {
    if (!valid) return;
    onSave(draft);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit targets"
      className="max-w-[380px] p-5"
    >
      {priced.length === 0 ? (
        <p className="text-[13px] leading-[1.5] text-muted">
          Add priced holdings before setting target weights.
        </p>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setDraft(equalTargets(mints))}
              className="rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              Equal weight
            </button>
            <button
              type="button"
              onClick={() => setDraft(targetsFromActual(holdings))}
              className="rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
            >
              Match current
            </button>
          </div>

          <ul className="max-h-[min(52vh,360px)] space-y-3 overflow-y-auto pr-1">
            {priced.map((holding) => {
              const mint = holding.asset.mint;
              const symbol = assetSymbol(holding.asset);
              const value = draft[mint] ?? 0;
              return (
                <li key={mint}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-extrabold">{symbol}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={Number.isFinite(value) ? value : 0}
                        onChange={(event) => setWeight(mint, Number(event.target.value))}
                        className="tabular-nums w-14 rounded-lg bg-[var(--segment-track)] px-2 py-1 text-right text-[13px] font-bold text-ink shadow-inset-soft"
                      />
                      <span className="text-[12px] font-semibold text-faint">%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={value}
                    onChange={(event) => setWeight(mint, Number(event.target.value))}
                    className="w-full accent-[var(--brand-500)]"
                  />
                </li>
              );
            })}
          </ul>

          <div
            className={cn(
              "tabular-nums mt-4 text-center text-[13px] font-bold",
              valid ? "text-muted" : "text-price-down",
            )}
          >
            Total: {total.toFixed(1)}% {valid ? "" : "· must equal 100%"}
          </div>

          <Button variant="primary" fullWidth className="mt-4" disabled={!valid} onClick={save}>
            Save targets
          </Button>
        </>
      )}
    </Modal>
  );
}
