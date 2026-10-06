"use client";

import {useCallback, useEffect, useRef, useState} from "react";
import {useRouter} from "next/navigation";

import {BellIcon, RocketIcon} from "@/components/ui/Icons";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {readBannerClosed, writeBannerClosed} from "@/lib/localStore";
import {profilePath} from "@/lib/routes";

/** How long a slide holds before the next one. */
const ADVANCE_MS = 6_000;

/** Horizontal travel that counts as a swipe rather than a tap. */
const SWIPE_PX = 40;

interface Slide {
  id: string;
  title: string;
  body: string;
  art: React.ReactNode;
}

/**
 * The three things worth knowing about on a first visit.
 *
 * In this order on purpose: the ladder is the reason to post, Create is the
 * reason to stay, and alerts are the reason to come back.
 */
function slides(): Slide[] {
  return [
    {
      id: "ranks",
      title: "Climb from Intern to GOAT",
      body: "Earn rep when holders upvote your calls",
      // eslint-disable-next-line @next/next/no-img-element
      art: <img src="/ranks/goat.svg" alt="" width={46} height={46} />,
    },
    {
      id: "create",
      title: "Launch a coin on any stock",
      body: "Pick a tokenised stock, name it, and it's live in seconds",
      art: <RocketIcon className="h-[26px] w-[26px] text-white" />,
    },
    {
      id: "alerts",
      title: "Never miss a call",
      body: "Get alerts when people you follow trade or coins move",
      art: <BellIcon className="h-[26px] w-[26px] text-white" />,
    },
  ];
}

/**
 * The banner at the top of Home.
 *
 * One card, three slides, and no controls on it beyond the close: the whole
 * card is the tap target, so there is nothing to aim at. It closes for good
 * rather than for the session — a thing you have dismissed and which comes
 * back is worse than one that was never there.
 */
export function HomeBanner({onCreate}: {onCreate: () => void}) {
  const router = useRouter();
  const {handle} = useUser();

  const [closed, setClosed] = useState(true);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const startX = useRef<number | null>(null);

  const deck = slides();

  // Read after mount: localStorage does not exist while rendering on the
  // server, and a banner that flashes in and out on load is worse than one
  // that arrives a moment late.
  useEffect(() => setClosed(readBannerClosed()), []);

  useEffect(() => {
    if (closed || held) return;
    const timer = setTimeout(() => setIndex((at) => (at + 1) % deck.length), ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [closed, held, index, deck.length]);

  const open = useCallback(
    (slide: Slide) => {
      if (slide.id === "create") return onCreate();
      if (slide.id === "alerts") return router.push("/notifications?settings=1");
      if (handle) router.push(profilePath(handle));
    },
    [handle, onCreate, router],
  );

  if (closed) return null;

  const slide = deck[index];

  const close = (event: React.MouseEvent) => {
    event.stopPropagation();
    writeBannerClosed();
    setClosed(true);
  };

  return (
    <div className="mb-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => open(slide)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") open(slide);
        }}
        onTouchStart={(event) => {
          setHeld(true);
          startX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          setHeld(false);
          const from = startX.current;
          startX.current = null;
          if (from === null) return;

          const moved = (event.changedTouches[0]?.clientX ?? from) - from;
          if (Math.abs(moved) < SWIPE_PX) return;
          // A swipe is a swipe, not a tap: stop the click that follows it from
          // opening whatever the card was showing.
          event.preventDefault();
          setIndex((at) => (at + (moved < 0 ? 1 : deck.length - 1)) % deck.length);
        }}
        onMouseDown={() => setHeld(true)}
        onMouseUp={() => setHeld(false)}
        onMouseLeave={() => setHeld(false)}
        className="relative flex h-[104px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[20px] pb-4 pl-[18px] pr-4 pt-4 text-left"
        style={{
          background:
            "linear-gradient(135deg, #A45BFF 0%, #8B3DF5 52%, #6D28D9 100%)",
        }}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold leading-[1.2] text-white">
            {slide.title}
          </p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-[1.35] text-white/85">
            {slide.body}
          </p>
        </div>

        <span className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-white/[0.16]">
          {slide.art}
        </span>

        {/*
          The cross is small because it is not the point of the card, and its
          tap area is 44px because a thumb is. The two sizes are independent:
          the button is padded out past the icon and pulled back into the
          corner with a negative offset, so nothing moves to make room for it.
        */}
        <button
          type="button"
          onClick={close}
          aria-label="Hide this"
          className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-white/70 transition-colors hover:text-white"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <path
              d="M3.5 3.5l9 9M12.5 3.5l-9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/*
        Bars rather than dots. The active one is longer as well as brighter, so
        which slide this is reads without relying on colour alone.
      */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {deck.map((entry, at) => (
          <span
            key={entry.id}
            className={cn(
              "h-[3px] rounded-full transition-all duration-200",
              at === index ? "w-6 bg-[#9945FF]" : "w-3 bg-[#3A3842]",
            )}
          />
        ))}
      </div>
    </div>
  );
}
