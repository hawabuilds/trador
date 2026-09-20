"use client";

import {useEffect, useMemo, useState} from "react";

import {Button} from "@/components/ui/Button";
import {Sheet, SheetFooter, SheetTitle} from "@/components/ui/Sheet";
import {
  fromBaseUnits,
  spendableLamports,
  SOL_FEE_RESERVE_LAMPORTS,
  toBaseUnits,
} from "@/lib/amounts";
import {confirmSignature} from "@/lib/confirmSignature";
import {txUrl} from "@/config/explorer";
import {cn} from "@/lib/cn";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {useSession} from "@/lib/session";

const inputClass =
  "w-full rounded-2xl bg-[var(--bg-input)] px-3.5 py-3 text-[14px] font-medium text-ink shadow-inset-soft outline-none transition-[box-shadow,background-color] placeholder:text-faint focus:shadow-inset-focus";

export function SendSheet({
  open,
  onClose,
  wallet,
  solLamports,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  wallet: Pubkey;
  solLamports: number;
  onSent?: () => void;
}) {
  const {signAndSend} = useSession();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const balance = BigInt(solLamports);
  const spendable = spendableLamports(balance);
  const spendableSol = fromBaseUnits(spendable, 9);

  const parsedRecipient = useMemo(() => asPubkey(recipient), [recipient]);
  const parsedLamports = useMemo(() => toBaseUnits(amount, 9), [amount]);

  useEffect(() => {
    if (!open) {
      setRecipient("");
      setAmount("");
      setBusy(false);
      setStatus(null);
      setError(null);
      setSignature(null);
    }
  }, [open]);

  const valid =
    parsedRecipient !== null &&
    parsedLamports !== null &&
    parsedLamports > 0n &&
    parsedLamports <= spendable;

  async function send() {
    if (!signAndSend || !parsedRecipient || !parsedLamports) return;
    setBusy(true);
    setError(null);
    setStatus("Building…");
    try {
      const response = await fetch("/api/transfer/build", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({
          from: wallet,
          to: parsedRecipient,
          lamports: parsedLamports.toString(),
        }),
      });
      const body = (await response.json()) as {
        transfer?: {transactionBase64: string};
        error?: string;
      };
      if (!response.ok || !body.transfer) {
        throw new Error(body.error ?? "Could not build this transfer.");
      }

      setStatus("Waiting for your signature…");
      const bytes = Uint8Array.from(atob(body.transfer.transactionBase64), (c) =>
        c.charCodeAt(0),
      );
      const sig = await signAndSend(bytes);

      setStatus("Confirming on-chain…");
      const outcome = await confirmSignature(sig);
      if (outcome === "failed") throw new Error("Transfer failed on-chain.");

      setSignature(sig);
      setStatus(null);
      onSent?.();
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Send SOL"
      header={<SheetTitle title="Send" onClose={onClose} />}
      footer={
        signature ? (
          <SheetFooter columns={1}>
            <Button fullWidth onClick={onClose}>
              Done
            </Button>
          </SheetFooter>
        ) : (
          <SheetFooter columns={1}>
            <Button
              fullWidth
              disabled={!valid || busy || !signAndSend}
              onClick={() => void send()}
            >
              {busy ? (status ?? "Sending…") : "Send SOL"}
            </Button>
          </SheetFooter>
        )
      }
    >
      <div className="flex flex-col gap-3.5 pb-2 pt-1">
        {!signAndSend ? (
          <p className="text-[14px] leading-[1.55] text-muted">
            Demo mode cannot send SOL. Sign in with a real wallet to use Send.
          </p>
        ) : signature ? (
          <div className="text-center">
            <p className="text-[15px] font-extrabold text-ink">Sent</p>
            <a
              href={txUrl(signature)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-mono text-[12px] text-accent-link underline underline-offset-2"
            >
              View on explorer
            </a>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-2.5 text-[12.5px] font-semibold shadow-inset-soft">
              <span className="text-faint">Available</span>
              <span className="tabular-nums font-extrabold text-ink">{spendableSol} SOL</span>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
                To
              </label>
              <input
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder="Solana address"
                spellCheck={false}
                className={cn("font-mono text-[14px]", inputClass)}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold uppercase tracking-[0.07em] text-faint">
                  Amount (SOL)
                </label>
                <button
                  type="button"
                  disabled={spendable <= 0n}
                  onClick={() => setAmount(spendableSol)}
                  className="text-[11px] font-extrabold text-brand-400 transition-colors hover:text-brand-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send all
                </button>
              </div>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className={cn("tabular-nums text-[18px] font-extrabold", inputClass)}
              />
            </div>

            <p className="text-[11px] leading-snug text-faint">
              {fromBaseUnits(SOL_FEE_RESERVE_LAMPORTS, 9)} SOL is kept for network fees.
            </p>

            {recipient && !parsedRecipient ? (
              <p className="text-[12.5px] font-semibold text-price-down">
                That does not look like a valid Solana address.
              </p>
            ) : null}

            {parsedLamports !== null && parsedLamports > spendable ? (
              <p className="text-[12.5px] font-semibold text-price-down">
                Not enough SOL — you can send up to {spendableSol} SOL.
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-[12.5px] font-semibold text-price-down">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
