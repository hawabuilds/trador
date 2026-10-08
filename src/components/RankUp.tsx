"use client";

import {useEffect, useState} from "react";

import {RankBadge} from "@/components/ui/RankBadge";
import {rankById, type RankId} from "@/config/ranks";
import {readRankSeen, writeRankSeen} from "@/lib/localStore";
import {currentSeason} from "@/lib/ranks";
import {useNotifications} from "@/hooks/useNotifications";
import {useUser} from "@/hooks/useUser";

/**
 * The one screen that interrupts anything.
 *
 * Shown once, when somebody's rank goes up, and never again: the rank-up is a
 * row in the notifications list afterwards, so nothing is lost by closing it.
 * It reads from that same row rather than from a flag, which means a rank-up
 * earned while the app was shut still gets its moment.
 */
export function RankUp() {
  const {items} = useNotifications();
  const {handle} = useUser();
  const [seen, setSeen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // After mount: localStorage does not exist while rendering on the server.
  useEffect(() => {
    setSeen(readRankSeen());
    setReady(true);
  }, []);

  const latest = items.find((item) => item.kind === "rank_up" && item.rank);
  const key = latest ? latest.id : null;

  if (!ready || !latest || !latest.rank || key === seen) return null;

  const rank = rankById(latest.rank as RankId);
  const season = currentSeason();

  const close = () => {
    if (key) writeRankSeen(key);
    setSeen(key);
  };

  const share =
    "https://x.com/intent/tweet?text=" +
    encodeURIComponent(`I'm a ${rank.name} on Trador. ${season.name}.`) +
    "&url=" +
    encodeURIComponent(
      `${typeof window === "undefined" ? "" : window.location.origin}/u/${handle ?? ""}`,
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`You are a ${rank.name}`}
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(0_0_0/82%)] px-6"
    >
      <div className="flex w-full max-w-[22rem] flex-col items-center text-center">
        <RankBadge rank={rank.id} size={128} />

        <p className="mt-6 text-[13px] font-semibold uppercase tracking-[0.18em] text-faint">
          {season.name}
        </p>
        <h1 className="mt-2 text-[28px] font-bold tracking-[-0.03em] text-ink">
          You&apos;re a {rank.name}
        </h1>
        <p className="mt-2 text-[15px] leading-[1.45] text-muted">{rank.line}</p>

        <a
          href={share}
          target="_blank"
          rel="noopener noreferrer"
          onClick={close}
          className="mt-7 flex h-12 w-full items-center justify-center rounded-full bg-brand-500 text-[15px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Share on &#120143;
        </a>

        <button
          type="button"
          onClick={close}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-full text-[15px] font-medium text-muted transition-colors hover:text-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
