"use client";

import type {ReactNode} from "react";

import {ArrowDownIcon, ArrowUpIcon} from "@/components/ui/Icons";
import {cn} from "@/lib/cn";

export function WalletActionsRow({
  onSend,
  onReceive,
  disabled = false,
}: {
  onSend: () => void;
  onReceive: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex gap-2">
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
        "flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-[21px] bg-[var(--overlay-wash)]",
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
