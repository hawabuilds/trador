"use client";

import type {ReactNode} from "react";

import {ArrowDownIcon, ArrowUpIcon, PlusIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";

export function WalletActionsRow({
  onDeposit,
  onSend,
  onReceive,
  disabled = false,
}: {
  onDeposit: () => void;
  onSend: () => void;
  onReceive: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <ActionButton label="Deposit" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={onDeposit} disabled={disabled} />
      <ActionButton label="Send" icon={<ArrowUpIcon className="h-3.5 w-3.5" />} onClick={onSend} disabled={disabled} />
      <ActionButton label="Receive" icon={<ArrowDownIcon className="h-3.5 w-3.5" />} onClick={onReceive} disabled={disabled} />
    </div>
  );
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-[14px] bg-[var(--overlay-wash)] py-2.5",
        "text-[13px] font-bold text-ink transition-[background-color,transform] duration-200",
        disabled
          ? "cursor-not-allowed opacity-45"
          : "hover:bg-[var(--overlay-wash-hover)] active:scale-[0.98]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
