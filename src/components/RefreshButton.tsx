"use client";

import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";

import {cn} from "@/lib/cn";
import {RefreshIcon} from "./ui/Icons";

/**
 * Pull the screen's data again, now.
 *
 * Everything here refetches on its own timer, but a timer is not an answer to
 * "is this current?" — so this refetches every query the screen is actually
 * using, which is the same set the screen would refetch on its own, just
 * immediately.
 *
 * It spins while the work is in flight and keeps spinning for a beat
 * afterwards: a refresh that returns identical data would otherwise look like
 * nothing happened, and a button that seems not to work gets pressed again.
 */
export function RefreshButton({className, label = "Refresh"}: {className?: string; label?: string}) {
  const queryClient = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  async function refresh() {
    if (spinning) return;
    setSpinning(true);
    const started = Date.now();
    try {
      await queryClient.refetchQueries({type: "active"});
    } finally {
      // A full turn, so the spin reads as a spin rather than a flicker.
      window.setTimeout(() => setSpinning(false), Math.max(0, 600 - (Date.now() - started)));
    }
  }

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      aria-label={label}
      aria-busy={spinning}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors",
        "hover:bg-[var(--overlay-wash)] hover:text-ink",
        className,
      )}
    >
      <RefreshIcon className={cn("h-[18px] w-[18px]", spinning && "animate-spin")} />
    </button>
  );
}
