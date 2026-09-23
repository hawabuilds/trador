"use client";

import {useEffect, useSyncExternalStore, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

import {APP_NAME} from "@/config/app";
import {TradorMark} from "@/components/ui/TradorMark";
import {useUser} from "@/hooks/useUser";
import {readReferral, saveReferral, visitorId} from "@/lib/referral";
import {readSignedInHint} from "@/lib/signedInHint";
import {Avatar} from "./ui/Avatar";
import {Button} from "./ui/Button";
import {AppleIcon, ArrowRightIcon, XIcon} from "./ui/Icons";
import {Modal} from "./ui/Modal";

/**
 * The landing page, laid out the way HODL's is.
 *
 * One claim, one line of explanation, one thing to press. The wordmark sits on
 * dark with clear space above the headline; the headline is light, large and on
 * two lines, with the payoff on the second in the accent colour.
 *
 * **"Stock app for trenchers."** HODL's own shape — "RWA app for trenchers" —
 * pointed at this app's universe, so the two read as siblings. The line under
 * it says what the app actually holds, which a tagline aimed at an audience
 * does not.
 *
 * The counts that used to sit here are gone. They read from the bundled
 * snapshot and said 140 coins while the live universe held thousands, and a
 * number on a front door that is wrong by forty times is worse than none.
 */
export function LoginScreen() {
  const router = useRouter();
  const {ready, authenticated, login, isDemo} = useUser();
  const [modalOpen, setModalOpen] = useState(false);

  /*
   * Was there a session here last time?
   *
   * `useSyncExternalStore` reads the hint on the first client render without
   * waiting for an effect, so a returning user never sees the marketing page
   * flash before Privy restores the session.
   */
  const returning = useSyncExternalStore(
    () => () => {},
    readSignedInHint,
    () => false,
  );

  useEffect(() => {
    if (ready && authenticated) router.replace("/home");
  }, [ready, authenticated, router]);

  /*
   * Hold rather than show the door to someone who already has a key.
   *
   * Privy reports `authenticated: false` while it restores a session, so a
   * returning user would otherwise watch this page for a second before being
   * sent in. Only held for someone this browser has seen signed in, so a
   * first-time visitor still gets the page immediately.
   */
  if ((returning && !ready) || (ready && authenticated)) {
    return (
      <div
        className="flex h-full flex-col justify-center bg-surface-base px-8 animate-pulse"
        aria-busy
        aria-label="Loading"
      >
        <div className="mb-[1em] h-10 w-36 rounded-md bg-surface-raised" />
        <div className="h-12 w-full max-w-[280px] rounded-md bg-surface-raised" />
        <div className="mt-5 h-5 w-48 rounded-md bg-surface-raised" />
      </div>
    );
  }

  const startLogin = () => {
    setModalOpen(false);
    login();
  };

  return (
    <div className="flex h-full flex-col justify-center bg-surface-base px-8 pb-[max(48px,env(safe-area-inset-bottom))]">
      <div className="mb-[1em] flex items-center gap-2.5 text-ink">
        <TradorMark size={40} className="text-brand-500" />
        <span className="text-[28px] font-extrabold tracking-[-0.04em]">{APP_NAME}</span>
      </div>

      <h1 className="display-light text-[clamp(38px,11vw,46px)] font-light leading-[1.02] tracking-[-0.045em]">
        Stock app for
        <br />
        <span className="font-medium text-accent-soft">trenchers</span>
      </h1>

      {/*
        The break is placed, not left to the browser. Balancing and a
        non-breaking hyphen both still produced an orphaned word at this width;
        the line has one natural pause, after the comma, so that is where it
        breaks.
      */}
      <p className="mt-5 text-[17px] font-normal leading-size-17 text-muted">
        Everything stock‑paired,
        <br />
        on Solana.
      </p>

      <InvitedBy />

      <div className="mt-11 flex flex-col gap-2.5">
        {isDemo ? (
          /*
            Demo mode has no login to open, so the button goes straight in —
            and says so, rather than letting someone find out at the moment
            they try to trade.
          */
          <Link
            href="/home"
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[17px] bg-brand-500 px-5 py-[18px] text-[16px] font-bold text-white shadow-brand transition-transform hover:-translate-y-0.5"
          >
            Join now
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        ) : (
          <Button size="lg" fullWidth onClick={() => setModalOpen(true)} disabled={!ready}>
            {ready ? "Join now" : "Loading…"}
            {ready ? <ArrowRightIcon className="ml-2 h-4 w-4" /> : null}
          </Button>
        )}

        <button
          type="button"
          disabled
          aria-label="iOS app coming soon"
          className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--bg-input)] px-5 py-[18px] text-[16px] font-bold tracking-[-0.01em] text-faint shadow-inset-soft"
        >
          <AppleIcon className="h-[19px] w-[19px]" />
          Coming soon
        </button>

        {isDemo ? (
          <p className="mt-2 text-center text-[11.5px] font-medium text-faint">
            Demo mode — set NEXT_PUBLIC_PRIVY_APP_ID for real login.
          </p>
        ) : null}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Log in or create an account"
      >
        <button
          type="button"
          onClick={startLogin}
          className="mb-2.5 flex w-full items-center justify-center gap-3 rounded-[15px] bg-brand-500 px-4 py-[15px] text-[16px] font-bold text-white shadow-brand transition-transform hover:-translate-y-px hover:bg-brand-600"
        >
          <XIcon className="h-[18px] w-[18px]" />
          Continue with X
        </button>
        <p className="mx-auto mt-4 max-w-[32ch] text-center text-[11.5px] leading-[1.5] text-muted">
          A wallet is created for you on the way in. Nothing to install, nothing
          to pay.
        </p>
      </Modal>
    </div>
  );
}

interface Inviter {
  handle: string;
  displayName: string;
  pfpUrl: string | null;
}

/**
 * "Invited by …", when someone arrived through a shared profile link.
 *
 * The handle comes from `?ref=` or from the browser's memory of a link opened
 * earlier, and is only shown once it resolves to a real account — a made-up
 * handle in a URL shows nothing rather than a name nobody has. The open is
 * counted here too, once per visitor.
 */
function InvitedBy() {
  const [inviter, setInviter] = useState<Inviter | null>(null);

  useEffect(() => {
    saveReferral(new URLSearchParams(window.location.search).get("ref"));
    const handle = readReferral();
    if (!handle) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(handle)}`);
        if (!response.ok) return;
        const body = (await response.json()) as {profile?: Inviter};
        if (!body.profile || cancelled) return;
        setInviter(body.profile);
        void fetch("/api/referrals/visit", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({handle: body.profile.handle, visitor: visitorId()}),
        }).catch(() => undefined);
      } catch {
        // No card is the right fallback for any failure here.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!inviter) return null;

  return (
    <div className="mt-8 flex items-center gap-3 rounded-2xl bg-[var(--segment-track)] px-3.5 py-3 shadow-inset-soft">
      <Avatar name={inviter.displayName} src={inviter.pfpUrl} seed={inviter.handle} size={36} />
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-faint">Invited by</div>
        <div className="truncate text-[14.5px] font-extrabold text-ink">
          {inviter.displayName}{" "}
          <span className="font-semibold text-faint">@{inviter.handle}</span>
        </div>
      </div>
    </div>
  );
}
