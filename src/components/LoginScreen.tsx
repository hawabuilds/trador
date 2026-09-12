"use client";

import {useEffect} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";

import {APP_NAME, APP_SUBTITLE, APP_TAGLINE} from "@/config/app";
import {useUser} from "@/hooks/useUser";
import {Button} from "./ui/Button";
import {XIcon} from "./ui/Icons";

/**
 * The front door.
 *
 * This is the login, not a marketing page with a login hidden inside it. The
 * previous version linked straight to `/home` and buried `login()` in the
 * Stonkfolio, which made a fully configured Privy look broken — the app worked
 * but nothing ever asked who you were.
 *
 * No wallet vocabulary anywhere on it. Someone arriving here has not agreed to
 * learn what a mint is, and a wallet is created for them on the way in.
 *
 * The counts are real, read from the universe. A number that turns out to be
 * decoration is worse than no number.
 */
export function LoginScreen({
  stonkCount,
  stockCount,
  verifiedCount,
}: {
  stonkCount: number;
  stockCount: number;
  verifiedCount: number;
}) {
  const router = useRouter();
  const {ready, authenticated, isDemo, login} = useUser();

  /**
   * Already signed in? Go straight in.
   *
   * Guarded on `ready`, because Privy reports `authenticated: false` while it is
   * still restoring a session — redirecting on that would bounce a signed-in
   * person back to the door on every cold load.
   */
  useEffect(() => {
    if (ready && authenticated) router.replace("/home");
  }, [ready, authenticated, router]);

  return (
    <main className="flex h-full flex-col justify-between px-7 pb-10 pt-[calc(56px+env(safe-area-inset-top,0px))]">
      <div>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-brand-400">
          Solana
        </p>
        <h1 className="mt-3 text-[38px] font-extrabold leading-[1.05] tracking-[-0.04em] text-ink">
          {APP_TAGLINE}
        </h1>
        <p className="mt-4 max-w-[31ch] text-[14px] leading-[1.6] text-muted">
          {APP_SUBTITLE}
        </p>

        <dl className="mt-9 grid grid-cols-3 gap-2.5">
          <Stat value={stonkCount.toLocaleString("en-US")} label="Stonks" />
          <Stat value={String(stockCount)} label="Stocks traded" />
          <Stat value={String(verifiedCount)} label="Verified" />
        </dl>
      </div>

      <div>
        {isDemo ? (
          <>
            {/*
              Demo mode says so on the front door rather than letting someone
              discover it at the moment they try to trade.
            */}
            <Link
              href="/home"
              className="flex h-[52px] w-full items-center justify-center rounded-full bg-brand-500 text-[15px] font-extrabold text-white shadow-brand transition-transform duration-150 hover:-translate-y-0.5"
            >
              Explore {APP_NAME}
            </Link>
            <p className="mt-3 text-center text-[11.5px] leading-[1.5] text-faint">
              Demo mode — browse everything, but trading and launching are off
              until a Privy app id is configured.
            </p>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              fullWidth
              onClick={login}
              disabled={!ready}
              className="h-[52px] text-[15px]"
            >
              <XIcon className="mr-2 h-[15px] w-[15px]" />
              {ready ? "Continue with X" : "Loading…"}
            </Button>
            <p className="mt-3 text-center text-[11.5px] leading-[1.5] text-faint">
              A wallet is created for you. Nothing to install, nothing to pay.
            </p>
          </>
        )}

        <Link
          href="/learn"
          className="mt-2.5 flex h-[46px] w-full items-center justify-center rounded-full text-[14px] font-bold text-muted transition-colors duration-150 hover:text-ink"
        >
          What is a tokenized stock?
        </Link>
      </div>
    </main>
  );
}

function Stat({value, label}: {value: string; label: string}) {
  return (
    <div className="rounded-[14px] bg-[var(--overlay-wash)] px-3 py-2.5">
      <dd className="tabular-nums text-[20px] font-extrabold leading-none tracking-[-0.02em] text-ink">
        {value}
      </dd>
      <dt className="mt-1.5 text-[10.5px] font-bold text-faint">{label}</dt>
    </div>
  );
}
