"use client";

import {useEffect, useState} from "react";
import {QRCodeSVG} from "qrcode.react";

import {Button} from "@/components/ui/Button";
import {CopyIcon} from "@/components/ui/Icons";
import {Sheet, SheetFooter, SheetTitle} from "@/components/ui/Sheet";
import type {Pubkey} from "@/lib/pubkey";

export function ReceiveSheet({
  open,
  onClose,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  wallet: Pubkey;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      height="auto"
      label="Receive SOL"
      header={<SheetTitle title="Receive" onClose={onClose} />}
      footer={
        <SheetFooter columns={1}>
          <Button fullWidth onClick={() => void copy()}>
            <span className="inline-flex items-center gap-2">
              <CopyIcon className="h-4 w-4" />
              {copied ? "Copied" : "Copy address"}
            </span>
          </Button>
        </SheetFooter>
      }
    >
      <div className="flex flex-col gap-3.5 pb-2 pt-1">
        <p className="text-center text-[11px] font-medium leading-[1.5] text-faint">
          Send SOL to this address on Solana mainnet.
        </p>

        <div className="mx-auto w-fit rounded-2xl bg-[var(--segment-track)] p-4 shadow-inset-soft">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={wallet} size={168} level="M" includeMargin={false} />
          </div>
        </div>

        <div className="break-all rounded-2xl bg-[var(--bg-input)] px-3.5 py-3 text-center font-mono text-[12.5px] leading-[1.55] text-ink shadow-inset-soft">
          {wallet}
        </div>
      </div>
    </Sheet>
  );
}
