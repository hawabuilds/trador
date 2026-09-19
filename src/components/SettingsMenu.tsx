"use client";

import {useEffect, useRef, useState} from "react";

import {accountUrl} from "@/config/explorer";
import {useMe} from "@/hooks/useMe";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {shortPubkey} from "@/lib/pubkey";
import {useSession} from "@/lib/session";
import {NotificationSettings} from "./NotificationSettings";
import {ExportWalletSheet, ImportWalletSheet} from "./WalletKeySheets";
import {Sheet, SheetTitle} from "./ui/Sheet";
import {Switch} from "./ui/Switch";
import {
  ArrowUpRightIcon,
  BellIcon,
  CopyIcon,
  LockIcon,
  LogoutIcon,
  SettingsIcon,
  UserIcon,
  WalletIcon,
} from "./ui/Icons";

/**
 * Settings, as a compact menu anchored to the gear — HODL's layout.
 *
 * This was a full-height sheet of grouped rows: wallet, an inline notifications
 * panel with every toggle expanded, lesson progress, the platform fee, and sign
 * out. It scrolled. HODL's is a small panel that grows out of its own control,
 * which keeps the connection between the gear and what it opened, and puts one
 * row per thing rather than every setting at once.
 *
 * So, in order: who you are, your wallet, then one row each for the things that
 * open something bigger — export, import, notifications — and sign out. The
 * notification toggles live behind their row in their own sheet, where there is
 * room for them. HODL's appearance switch has no counterpart: this app is dark
 * only.
 *
 * Lesson progress and the platform fee are gone from here. Neither is in
 * HODL's menu, and both are said where they matter — the fee on every order
 * ticket, progress on the Learn tab.
 */
export function SettingsMenu() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const {wallet, handle, displayName, isDemo, logout} = useUser();
  const {wallets, setActiveWallet, exportWallet, importWallet} = useSession();
  const me = useMe();
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  // Escape or a click anywhere else closes it, as a menu should.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [open]);

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(address);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  /** Close the menu, then open whatever the row leads to. */
  const then = (next: () => void) => () => {
    setOpen(false);
    next();
  };

  // One card per wallet when there are several; otherwise just the one.
  const cards =
    wallets.length > 1
      ? wallets.map((entry) => ({
          address: entry.address,
          title: entry.imported ? "Imported wallet" : "Your Trador wallet",
          active: entry.address === wallet,
        }))
      : wallet
        ? [{address: wallet, title: "Your Trador wallet", active: true}]
        : [];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Settings"
        className={cn(
          "-mr-1 grid h-9 w-9 place-items-center rounded-full transition-colors",
          open
            ? "bg-[var(--overlay-wash-hover)] text-ink"
            : "text-muted hover:bg-[var(--overlay-wash)] hover:text-ink",
        )}
      >
        <SettingsIcon className="h-[19px] w-[19px]" />
      </button>

      <div
        role="menu"
        aria-label="Settings"
        className={cn(
          "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(286px,calc(100vw-44px))]",
          "rounded-2xl bg-surface-popup p-2 shadow-panel",
          "origin-top-right transition-[opacity,transform,visibility] duration-150",
          open
            ? "visible scale-100 opacity-100"
            : "pointer-events-none invisible scale-[0.96] opacity-0",
        )}
      >
        <div className="px-2.5 pb-2.5 pt-2">
          <div className="truncate text-[14px] font-extrabold tracking-[-0.01em]">
            {displayName ?? "Trader"}
          </div>
          <div className="truncate text-[12px] font-medium text-faint">
            {handle ? `@${handle}` : isDemo ? "Demo mode" : "Signed in"}
          </div>
        </div>

        {cards.length > 0 ? (
          <div className="mx-1 flex flex-col gap-2">
            {cards.map((card) => (
              <WalletCard
                key={card.address}
                title={card.title}
                subtitle={
                  card.active
                    ? "Trades and counts toward your Stonkfolio"
                    : "Tap to trade from this wallet"
                }
                address={card.address}
                active={card.active}
                copied={copied === card.address}
                onCopy={() => void copy(card.address)}
                onSelect={
                  !card.active && setActiveWallet
                    ? () => setActiveWallet(card.address)
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <p className="mx-1 rounded-[13px] bg-[var(--overlay-wash)] px-3 py-2.5 text-[11.5px] leading-snug text-faint">
            {isDemo
              ? "Demo mode uses a sample wallet. Configure a Privy app id to get your own."
              : "No wallet yet. One is created when you sign in."}
          </p>
        )}

        <div className="mt-1 flex flex-col">
          {exportWallet && wallet ? (
            <MenuRow
              onClick={then(() => setExportOpen(true))}
              icon={<LockIcon className="h-4 w-4" />}
              label="Export private key"
            />
          ) : null}
          {importWallet ? (
            <MenuRow
              onClick={then(() => setImportOpen(true))}
              icon={<WalletIcon className="h-4 w-4" />}
              label="Import a wallet"
            />
          ) : null}
          <MenuRow
            onClick={then(() => setNotifyOpen(true))}
            icon={<BellIcon className="h-4 w-4" />}
            label="Notifications"
          />
          {/*
            A switch rather than a row that opens something, so the menu stays
            open and the change is visible where it was made. HODL's default:
            on, until someone chooses otherwise.
          */}
          {me.handle ? (
            <div className="mx-1 flex items-center gap-2 rounded-[10px] px-2.5 py-2">
              <span className="text-muted">
                <UserIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold text-ink">Public Stonkfolio</div>
                <div className="text-[11px] leading-snug text-faint">
                  {privacyError ??
                    (me.portfolioPublic
                      ? "Your holdings and value show on your profile"
                      : "Hidden from your profile, wallet included")}
                </div>
              </div>
              <Switch
                on={me.portfolioPublic}
                label="Show my Stonkfolio on my profile"
                onChange={() => {
                  setPrivacyError(null);
                  me.setPortfolioPublic(!me.portfolioPublic).catch(() =>
                    setPrivacyError("Couldn't save. Try again."),
                  );
                }}
              />
            </div>
          ) : null}
        </div>

        {!isDemo && wallet ? (
          <button
            type="button"
            role="menuitem"
            onClick={then(logout)}
            className="mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-[14px] font-bold text-price-down transition-colors hover:bg-[var(--overlay-wash)]"
          >
            <LogoutIcon className="h-4 w-4" />
            Sign out
          </button>
        ) : null}

        <p className="mt-1 px-2.5 pb-1.5 text-[10px] font-medium leading-snug text-faint">
          Charts by{" "}
          <a
            href="https://www.tradingview.com/lightweight-charts/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-link underline decoration-[var(--overlay-wash-hover)] underline-offset-2 hover:text-accent"
          >
            Lightweight Charts
          </a>
        </p>
      </div>

      <Sheet
        open={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        height="auto"
        label="Notifications"
        header={<SheetTitle title="Notifications" onClose={() => setNotifyOpen(false)} />}
      >
        <div className="overflow-hidden rounded-2xl bg-surface-card pb-1 shadow-card">
          <NotificationSettings />
        </div>
      </Sheet>

      <ExportWalletSheet
        open={exportOpen}
        address={wallet}
        onExport={exportWallet}
        onClose={() => setExportOpen(false)}
      />
      <ImportWalletSheet
        open={importOpen}
        onImport={importWallet}
        onClose={() => setImportOpen(false)}
      />
    </div>
  );
}

function WalletCard({
  title,
  subtitle,
  address,
  active,
  copied,
  onCopy,
  onSelect,
}: {
  title: string;
  subtitle: string;
  address: string;
  active: boolean;
  copied: boolean;
  onCopy: () => void;
  /** Present when this wallet is not the one trading and can be made so. */
  onSelect?: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[13px] bg-[var(--overlay-wash)] px-3 py-2.5",
        onSelect && "cursor-pointer transition-colors hover:bg-[var(--overlay-wash-hover)]",
      )}
      onClick={onSelect}
      role={onSelect ? "button" : undefined}
    >
      <div className="flex items-center gap-2">
        <div className="text-[12.5px] font-bold">{title}</div>
        {active ? (
          <span className="rounded-full bg-[var(--price-up-wash)] px-1.5 py-0.5 text-[10px] font-bold text-price-up">
            Active
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-faint">{subtitle}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium text-muted">
          {copied ? "Copied" : shortPubkey(address, 5, 5)}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          aria-label={copied ? "Address copied" : "Copy address"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-surface-card hover:text-ink"
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </button>
        <a
          href={accountUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          aria-label="View on the explorer"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-muted transition-colors hover:bg-surface-card hover:text-ink"
        >
          <ArrowUpRightIcon className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function MenuRow({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left text-[14px] font-bold text-ink transition-colors hover:bg-[var(--overlay-wash)]"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  );
}
