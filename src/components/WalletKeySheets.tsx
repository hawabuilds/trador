"use client";

import {useEffect, useState} from "react";

import {shortPubkey, type Pubkey} from "@/lib/pubkey";
import {importProblem} from "@/lib/wallets";
import {Button} from "./ui/Button";
import {Sheet, SheetTitle} from "./ui/Sheet";

/**
 * Export: a confirmation, then Privy's own screen.
 *
 * The key is revealed inside Privy's iframe on Privy's domain. This sheet only
 * says what is about to happen and hands off — the same shape as HODL's.
 */
export function ExportWalletSheet({
  open,
  address,
  onExport,
  onClose,
}: {
  open: boolean;
  address: Pubkey | null;
  onExport: ((address: Pubkey) => Promise<void>) | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  async function start() {
    if (!onExport || !address) return;
    setBusy(true);
    setError(null);
    try {
      await onExport(address);
      onClose();
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      // Closing Privy's screen part-way is not a failure worth reporting.
      if (!/exit|clos|cancel/i.test(message)) setError("Could not open the export screen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Export wallet"
      header={<SheetTitle title="Export wallet" onClose={onClose} />}
    >
      <p className="mt-1 text-[14px] leading-[1.55] text-muted">
        This shows the private key for{" "}
        <span className="font-mono text-ink">{address ? shortPubkey(address, 5, 5) : "your wallet"}</span>,
        so you can use it in Phantom, Solflare or Backpack.
      </p>
      <p className="mt-3 text-[13px] leading-[1.55] text-faint">
        The key opens in Privy&apos;s secure screen — Trador never sees it. Anyone
        who has it controls this wallet and everything in it, so store it
        somewhere only you can reach and never share it.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
          {error}
        </p>
      ) : null}
      <Button fullWidth className="mt-5" disabled={busy || !onExport || !address} onClick={() => void start()}>
        {busy ? "Opening export…" : "Continue"}
      </Button>
    </Sheet>
  );
}

/**
 * Import: the only screen in Trador that ever holds a private key.
 *
 * Privy offers no hosted import screen, so the key is typed here and passed
 * straight to its SDK. The field is masked, kept out of autofill and password
 * managers, never logged, never sent to Trador's server, and wiped whenever
 * the sheet closes or the import finishes.
 */
export function ImportWalletSheet({
  open,
  onImport,
  onClose,
}: {
  open: boolean;
  onImport: ((privateKey: string) => Promise<Pubkey>) | null;
  onClose: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Pubkey | null>(null);

  // Nothing survives the sheet closing, whatever state it closed in.
  useEffect(() => {
    if (!open) {
      setSecret("");
      setError(null);
      setImported(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => () => setSecret(""), []);

  async function submit() {
    if (!onImport) return;
    const problem = importProblem(secret);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const key = secret;
    // Out of state before the network round trip, not after it.
    setSecret("");
    try {
      setImported(await onImport(key));
    } catch (caught) {
      const message = (caught as Error).message ?? "";
      setError(
        /already/i.test(message)
          ? "This account already has an imported wallet. Privy allows one."
          : /exit|clos|cancel/i.test(message)
            ? "Import cancelled."
            : // Never echo the provider's text back: it is the one error path
              // that could conceivably include what was pasted.
              "Could not import that wallet. Check the key and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Import wallet"
      header={<SheetTitle title="Import wallet" onClose={onClose} />}
    >
      {imported ? (
        <>
          <p role="status" className="mt-1 text-[14px] leading-[1.55] text-muted">
            Imported{" "}
            <span className="font-mono text-ink">{shortPubkey(imported, 5, 5)}</span>. Trading
            and your Stonkfolio now use this wallet — switch back any time in
            Settings.
          </p>
          <Button fullWidth className="mt-5" onClick={onClose}>
            Done
          </Button>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="mt-1 text-[14px] leading-[1.55] text-muted">
            Bring an existing Solana wallet into Trador with its private key. It
            becomes the wallet you trade from.
          </p>
          <p className="mt-3 text-[13px] leading-[1.55] text-faint">
            Only paste a key you exported yourself, and never because someone
            asked you to — no one from Trador or Privy will. The key is handed
            to Privy&apos;s secure storage and is not kept by Trador. One
            imported wallet per account.
          </p>

          <label htmlFor="import-secret" className="mt-4 block text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
            Private key
          </label>
          <input
            id="import-secret"
            type="password"
            value={secret}
            onChange={(event) => {
              setSecret(event.target.value);
              setError(null);
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // Password managers would otherwise offer to save it.
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            placeholder="Base58 private key"
            className="mt-1.5 w-full rounded-2xl bg-[var(--bg-input)] px-4 py-3.5 font-mono text-[13px] text-ink shadow-inset-soft outline-none placeholder:font-sans placeholder:text-faint focus:shadow-inset-focus"
          />

          {error ? (
            <p role="alert" className="mt-3 text-[12.5px] font-semibold text-error">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            fullWidth
            className="mt-5"
            disabled={busy || !onImport || secret.trim() === ""}
          >
            {busy ? "Importing…" : "Import wallet"}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
