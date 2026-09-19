"use client";

import {cn} from "@/lib/cn";

/** An on/off switch. Shared so every setting in the app flips the same way. */
export function Switch({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-brand-500" : "bg-[var(--segment-track)]",
        disabled && "opacity-40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[3px] h-5 w-5 rounded-full bg-white transition-[left] duration-200",
          on ? "left-[21px]" : "left-[3px]",
        )}
      />
    </button>
  );
}
