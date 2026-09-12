"use client";

import {useEffect, useState} from "react";

import {useTheme} from "@/hooks/useTheme";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {accountUrl} from "@/config/explorer";
import {FEE_BPS} from "@/config/fees";
import {LESSON_COUNT} from "@/lib/learn";
import {readLearnDone, writeLearnDone} from "@/lib/localStore";
import {shortPubkey} from "@/lib/pubkey";
import {Sheet, SheetTitle} from "./ui/Sheet";
import {
  ArrowUpRightIcon,
  CapIcon,
  CheckIcon,
  CopyIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
  WalletIcon,
} from "./ui/Icons";

/**
 * Settings, reached from the Stonkfolio header.
 *
 * A sheet rather than its own route: everything in here is a switch or a piece
 * of account plumbing, and none of it is worth a back-stack entry or a URL
 * somebody might share.
 *
 * The wallet address is shown and copyable but the app never offers to export a
 * key. Privy owns that flow and does it inside its own UI, with its own
 * warnings — reimplementing it here would mean handling key material in this
 * codebase, which is the one thing worth refusing outright.
 */
export function SettingsMenu({open, onClose}: {open: boolean; onClose: () => void}) {
  const {theme, setTheme} = useTheme();
  const {wallet, handle, displayName, isDemo, logout} = useUser();

  const [copied, setCopied] = useState(false);
  const [learnDone, setLearnDone] = useState(0);

  useEffect(() => {
    if (open) setLearnDone(readLearnDone(LESSON_COUNT));
  }, [open]);

  async function copyWallet() {
    if (!wallet) return;
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
      label="Settings"
      header={<SheetTitle title="Settings" onClose={onClose} />}
    >
      <div className="pb-3">
        <Group label="Appearance">
          <div className="flex gap-2 px-1 py-2">
            {(
              [
                {value: "dark", label: "Dark", icon: <MoonIcon className="h-4 w-4" />},
                {value: "light", label: "Light", icon: <SunIcon className="h-4 w-4" />},
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-[12px] py-2.5 text-[13.5px] font-extrabold transition-colors",
                  theme === option.value
                    ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                    : "bg-[var(--overlay-wash)] text-faint hover:text-muted",
                )}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </Group>

        <Group label="Wallet">
          {wallet ? (
            <>
              <Row
                label={displayName ?? handle ?? "Your wallet"}
                value={copied ? "Copied" : shortPubkey(wallet, 5, 5)}
                onClick={() => void copyWallet()}
                icon={<CopyIcon className="h-3.5 w-3.5" />}
              />
              <Row
                label="View on the explorer"
                href={accountUrl(wallet)}
                icon={<ArrowUpRightIcon className="h-3.5 w-3.5" />}
              />
              {/*
                Export is Privy's flow, inside Privy's UI. Said plainly rather
                than omitted, so nobody goes looking for it here.
              */}
              <Note>
                Your key lives with Privy. Export it from their wallet screen —
                Trador never handles key material.
              </Note>
            </>
          ) : (
            <Note>
              {isDemo
                ? "Demo mode uses a sample wallet. Configure a Privy app id to get your own."
                : "No wallet yet. One is created when you sign in."}
            </Note>
          )}
        </Group>

        <Group label="Learn">
          <Row
            label="Lessons completed"
            value={`${learnDone}/${LESSON_COUNT}`}
            icon={<CapIcon className="h-3.5 w-3.5" />}
          />
          {learnDone > 0 ? (
            <Row
              label="Reset progress"
              value="Reset"
              danger
              onClick={() => {
                writeLearnDone(0, LESSON_COUNT);
                setLearnDone(0);
              }}
            />
          ) : null}
        </Group>

        <Group label="Trading">
          <Row label="Platform fee" value={`${FEE_BPS / 100}%`} />
          <Note>
            Taken by the router on the output of a swap. Nothing else — no
            spread, no withdrawal fee.
          </Note>
        </Group>

        {!isDemo && wallet ? (
          <Group label="Session">
            <Row
              label="Sign out"
              value="Sign out"
              danger
              icon={<LogoutIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                logout();
                onClose();
              }}
            />
          </Group>
        ) : null}
      </div>
    </Sheet>
  );
}

function Group({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-faint">
        {label}
      </h3>
      <div className="overflow-hidden rounded-2xl bg-surface-card shadow-card">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  onClick,
  href,
  icon,
  danger,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  const body = (
    <>
      <span className="text-[13px] font-bold">{label}</span>
      <span
        className={cn(
          "tabular-nums flex shrink-0 items-center gap-1.5 text-[13px] font-extrabold",
          danger ? "text-price-down" : "text-muted",
        )}
      >
        {value}
        {icon}
      </span>
    </>
  );

  const shared =
    "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors even:bg-[var(--overlay-wash)]/40 hover:bg-[var(--overlay-wash)]";

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={shared}>
        {body}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared}>
        {body}
      </button>
    );
  }

  return <div className={shared}>{body}</div>;
}

function Note({children}: {children: React.ReactNode}) {
  return (
    <p className="px-4 py-3 text-[12px] leading-[1.5] text-faint even:bg-[var(--overlay-wash)]/40">
      {children}
    </p>
  );
}
