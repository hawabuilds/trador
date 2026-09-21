"use client";

import {useEffect, useRef, useState} from "react";

import {APP_NAME, APP_TAGLINE} from "@/config/app";
import {cn} from "@/lib/cn";
import {profilePath, shareUrl} from "@/lib/routes";
import {CheckIcon, CopyIcon, ShareIcon, XIcon} from "./ui/Icons";

/** Baked in at build time, so it is the same on the server and in the browser. */
const CONFIGURED_ORIGIN = Boolean(process.env.NEXT_PUBLIC_APP_URL);

/**
 * Share your profile — which is also your invite link.
 *
 * On a phone this opens the system share sheet, which already knows every app
 * the person uses; there is no point rebuilding it. Where the browser has no
 * share sheet (most desktops), a small menu offers the two things people
 * actually do with a link: copy it, or post it on X.
 *
 * Anyone who signs up after opening the link is attributed to this person —
 * see `src/lib/referral.ts`. Nothing about that is shown here: referral numbers
 * are the admin's, not the sharer's.
 */
export function ShareProfileButton({handle, displayName}: {handle: string; displayName: string | null}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  /*
   * Always the app's real domain when one is configured — www.trador.one —
   * whichever address this person happens to have the app open on. Building
   * it from the page's own origin handed out the Vercel address to everyone
   * using the app there, including anyone who installed it from that address.
   *
   * The page's origin is only the fallback for a deployment with no domain
   * set, where the code's default domain may not exist at all. Read after
   * mount, so the server's HTML and the first client render agree.
   */
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = CONFIGURED_ORIGIN
    ? shareUrl(profilePath(handle))
    : origin
      ? `${origin}${profilePath(handle)}`
      : shareUrl(profilePath(handle));
  const text = `${displayName ?? `@${handle}`} is on ${APP_NAME} — ${APP_TAGLINE.toLowerCase()}. Join me:`;

  // A click anywhere else, or Escape, closes the menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({title: `${displayName ?? handle} on ${APP_NAME}`, text, url});
        return;
      } catch (error) {
        // Dismissing the sheet is a choice, not a failure.
        if ((error as Error).name === "AbortError") return;
      }
    }
    setOpen((previous) => !previous);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void share();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--overlay-wash)] px-3 py-1.5 text-[12px] font-extrabold text-ink transition-colors hover:bg-[var(--overlay-wash-hover)]"
      >
        <ShareIcon className="h-3.5 w-3.5" />
        Share
      </button>

      <div
        role="menu"
        aria-label="Share your profile"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[236px] rounded-2xl bg-surface-popup p-2 shadow-panel",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open ? "visible scale-100 opacity-100" : "pointer-events-none invisible scale-[0.96] opacity-0",
        )}
      >
        <div className="truncate px-2.5 pb-2 pt-1.5 font-mono text-[11.5px] font-medium text-faint">
          {url.replace(/^https?:\/\//, "")}
        </div>
        <button
          type="button"
          role="menuitem"
          onClick={() => void copy()}
          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left text-[14px] font-bold text-ink transition-colors hover:bg-[var(--overlay-wash)]"
        >
          <span className="text-muted">
            {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
          </span>
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          role="menuitem"
          href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-[14px] font-bold text-ink transition-colors hover:bg-[var(--overlay-wash)]"
        >
          <span className="text-muted">
            <XIcon className="h-4 w-4" />
          </span>
          Post on X
        </a>
      </div>
    </div>
  );
}
