"use client";

import {useEffect, useState} from "react";

import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {accountUrl} from "@/config/explorer";
import {FEE_BPS} from "@/config/fees";
import {LESSON_COUNT} from "@/lib/learn";
import {readLearnDone, writeLearnDone} from "@/lib/localStore";
import {shortPubkey} from "@/lib/pubkey";
import {useSession} from "@/lib/session";
import {NotificationSettings} from "./NotificationSettings";
import {ExportWalletSheet, ImportWalletSheet} from "./WalletKeySheets";
import {Sheet, SheetTitle} from "./ui/Sheet";
import {
  ArrowUpRightIcon,
  CapIcon,
  CheckIcon,
  CopyIcon,
  LockIcon,
  LogoutIcon,
  WalletIcon,
} from "./ui/Icons";

/**
 * Settings, reached from the Stonkfolio header.
 *
 * A sheet rather than its own route: everything in here is a switch or a piece
 * of account plumbing, and none of it is worth a back-stack entry or a URL
 * somebody might share.
 *
 * Export opens Privy's own screen, so a key shown to the user never passes
 * through this app. Import is the one exception, because Privy has no hosted
 * screen for it — `ImportWalletSheet` says how that key is handled.
 */
export function SettingsMenu({open, onClose}: {open: boolean; onClose: () => void}) {
  const {wallet, handle, displayName, isDemo, logout} = useUser();
  const {wallets, setActiveWallet, exportWallet, importWallet} = useSession();

  const [copied, setCopied] = useState(false);
  const [learnDone, setLearnDone] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
    <>
      <Sheet
        open={open}
        onClose={onClose}
        height="auto"
        label="Settings"
        header={<SheetTitle title="Settings" onClose={onClose} />}
      >
        <div className="pb-3">
          {/*
            No appearance section. The app is dark only — every screen here is a
            chart, a tape or a price, and a light mode would be a second set of
            contrast ratios to keep honest for a surface nobody trades on.
          */}
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
                  With two wallets, say which one trades and let it be changed —
                  the portfolio and every order follow this choice.
                */}
                {wallets.length > 1
                  ? wallets.map((entry) => {
                      const trading = entry.address === wallet;
                      return (
                        <Row
                          key={entry.address}
                          label={`${entry.imported ? "Imported" : "Created at sign-in"} · ${shortPubkey(entry.address, 4, 4)}`}
                          value={trading ? "Trading" : "Use"}
                          icon={trading ? <CheckIcon className="h-3.5 w-3.5" /> : undefined}
                          onClick={
                            trading || !setActiveWallet
                              ? undefined
                              : () => setActiveWallet(entry.address)
                          }
                        />
                      );
                    })
                  : null}

                {exportWallet ? (
                  <Row
                    label="Export private key"
                    value="Export"
                    icon={<LockIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      onClose();
                      setExportOpen(true);
                    }}
                  />
                ) : null}
                {importWallet ? (
                  <Row
                    label="Import a wallet"
                    value="Import"
                    icon={<WalletIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      onClose();
                      setImportOpen(true);
                    }}
                  />
                ) : null}
                <Note>
                  {exportWallet
                    ? "Export opens Privy's secure screen, for use in Phantom, Solflare or Backpack. Anyone with your key controls this wallet."
                    : "Your key lives with Privy."}
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

          <Group label="Notifications">
            <NotificationSettings />
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
    </>
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
