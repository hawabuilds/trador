"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import Link from "next/link";

import {launchpadFace} from "@/config/launchpads";
import {txUrl} from "@/config/explorer";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {confirmSignature} from "@/lib/confirmSignature";
import {useSession} from "@/lib/session";
import {stocksByPopularity} from "@/lib/stocks/registry";
import {ArrowUpRightIcon, CheckIcon, RocketIcon} from "./ui/Icons";
import {Modal} from "./ui/Modal";

/**
 * Launch a coin priced in a stock — one form, one button, one signature.
 *
 * Laid out like the order ticket and the same size: a centred modal rather than
 * a page, because launching is an action, not a place.
 *
 * The button does the whole thing. It hosts the image and metadata, builds the
 * StonkFun launch, has the server simulate it on mainnet, asks the wallet for
 * its one signature, waits for the chain to confirm, and registers the coin so
 * its page exists straight away. Every step that can fail says so in words; a
 * build that would fail on-chain is refused before the wallet is ever asked.
 *
 * Launches go through StonkFun's reward platform, so every coin made here is a
 * StonkFun coin — listed on StonkFun, paying holders the transfer fee chosen
 * below, and indistinguishable from one launched on StonkFun's own site.
 */

type Stage =
  | {kind: "idle"}
  | {kind: "working"; label: string}
  | {kind: "done"; mint: string; signature: string; symbol: string}
  | {kind: "failed"; message: string};

/** A picked image, shrunk in the browser so the upload stays small. */
async function shrinkImage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });

  // A GIF keeps its animation; resizing through a canvas would flatten it.
  if (file.type === "image/gif") return source;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That file is not an image."));
    element.src = source;
  });

  // 512px is sharper than any launchpad shows a coin icon, at a fraction of
  // the bytes of a phone photo.
  const size = Math.min(512, Math.max(image.width, image.height));
  const scale = size / Math.max(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function CreateSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const {authenticated, wallet, login, isDemo} = useUser();
  const session = useSession();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quoteTicker, setQuoteTicker] = useState("NVDAx");
  const [feeBps, setFeeBps] = useState(100);
  const [image, setImage] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  const [links, setLinks] = useState({twitter: "", telegram: "", website: ""});
  const [stage, setStage] = useState<Stage>({kind: "idle"});
  const fileRef = useRef<HTMLInputElement>(null);

  const stocks = useMemo(() => stocksByPopularity(), []);

  // A fresh form each time it opens after a launch, not the last coin's.
  useEffect(() => {
    if (open && stage.kind === "done") {
      setName("");
      setSymbol("");
      setImage(null);
      setLinks({twitter: "", telegram: "", website: ""});
      setStage({kind: "idle"});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const working = stage.kind === "working";
  const ready =
    name.trim().length > 0 && /^[A-Z0-9]{1,10}$/.test(symbol) && image !== null && !working;

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      setImage(await shrinkImage(file));
    } catch (error) {
      setStage({kind: "failed", message: (error as Error).message});
    }
  }

  async function launch() {
    if (!ready || !wallet || !session.signAndSend) return;

    try {
      setStage({kind: "working", label: "Preparing your launch…"});
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in again to launch.");

      const response = await fetch("/api/launch/build", {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
        body: JSON.stringify({
          name: name.trim(),
          symbol,
          quoteTicker,
          feeBps,
          image,
          creator: wallet,
          ...links,
        }),
      });
      const built = (await response.json()) as {
        transaction?: string;
        mint?: string;
        pool?: string;
        image?: string;
        error?: string;
      };
      if (!response.ok || !built.transaction || !built.mint || !built.pool) {
        throw new Error(built.error ?? "Could not prepare the launch.");
      }

      setStage({kind: "working", label: "Approve in your wallet…"});
      const bytes = Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0));
      const signature = await session.signAndSend(bytes);

      setStage({kind: "working", label: "Launching on-chain…"});
      const outcome = await confirmSignature(signature);
      if (outcome === "failed") {
        throw new Error("The launch was rejected on-chain. Nothing was created.");
      }

      // Register it so its page exists now, not whenever the indexer reaches it.
      await fetch("/api/launch/confirm", {
        method: "POST",
        headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
        body: JSON.stringify({
          mint: built.mint,
          pool: built.pool,
          quoteTicker,
          name: name.trim(),
          symbol,
          image: built.image,
        }),
      }).catch(() => undefined);

      setStage({kind: "done", mint: built.mint, signature, symbol});
    } catch (error) {
      const message = (error as Error).message ?? "The launch failed.";
      setStage({
        kind: "failed",
        message: /reject|denied|cancel/i.test(message) ? "You cancelled the signature." : message,
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      surface="popup"
      title={stage.kind === "done" ? `${stage.symbol} is live` : "Launch a coin"}
      className="max-w-[352px] p-5 pt-5"
    >
      {stage.kind === "done" ? (
        <Launched mint={stage.mint} signature={stage.signature} onClose={onClose} />
      ) : (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Choose an image"
              className={cn(
                "grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--bg-input)] text-[11px] font-bold text-faint shadow-inset-soft transition-colors hover:text-muted",
              )}
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="h-full w-full object-cover" />
              ) : (
                "Image"
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => void pickImage(event.target.files?.[0])}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 32))}
                placeholder="Name"
                aria-label="Coin name"
                className="h-[34px] rounded-xl bg-[var(--bg-input)] px-3 text-[13.5px] font-bold text-ink shadow-inset-soft outline-none placeholder:font-semibold placeholder:text-faint focus:shadow-inset-focus"
              />
              <input
                value={symbol}
                onChange={(event) =>
                  setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))
                }
                placeholder="TICKER"
                aria-label="Ticker"
                className="h-[34px] rounded-xl bg-[var(--bg-input)] px-3 text-[13.5px] font-extrabold uppercase tracking-[0.02em] text-ink shadow-inset-soft outline-none placeholder:font-semibold placeholder:text-faint focus:shadow-inset-focus"
              />
            </div>
          </div>

          <p className="mb-1.5 mt-3.5 text-[10px] font-bold uppercase tracking-[0.09em] text-faint">
            Priced in
          </p>
          {/*
            Every verified stock, most-launched first, on one scrolling rail —
            the order a coin priced in NVDAx moves with Nvidia, not with SOL.
          */}
          <div className="rail -mx-5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-5">
            {stocks.map((stock) => {
              const active = stock.ticker === quoteTicker;
              return (
                <button
                  key={stock.mint}
                  type="button"
                  onClick={() => setQuoteTicker(stock.ticker)}
                  aria-pressed={active}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
                    active
                      ? "bg-brand-500 text-white"
                      : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                  )}
                >
                  {stock.ticker}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-faint">Holder reward</span>
            <div className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]">
              {[100, 300].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  aria-pressed={feeBps === bps}
                  onClick={() => setFeeBps(bps)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11.5px] font-extrabold transition-colors",
                    feeBps === bps
                      ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                      : "text-faint hover:text-muted",
                  )}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>

          {showLinks ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {(["twitter", "telegram", "website"] as const).map((key) => (
                <input
                  key={key}
                  value={links[key]}
                  onChange={(event) => setLinks({...links, [key]: event.target.value})}
                  placeholder={
                    key === "twitter"
                      ? "https://x.com/…"
                      : key === "telegram"
                        ? "https://t.me/…"
                        : "https://…"
                  }
                  aria-label={key}
                  className="h-[32px] rounded-xl bg-[var(--bg-input)] px-3 text-[12.5px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowLinks(true)}
              className="mt-3 text-[12px] font-bold text-faint transition-colors hover:text-accent-link"
            >
              + Add links
            </button>
          )}

          {stage.kind === "failed" ? (
            <p role="alert" className="mt-3 text-[12px] font-semibold leading-[1.45] text-error">
              {stage.message}
            </p>
          ) : null}

          {!authenticated ? (
            <button
              type="button"
              onClick={login}
              className="mt-4 flex h-[50px] w-full items-center justify-center rounded-2xl bg-brand-500 text-[15px] font-extrabold text-white shadow-brand"
            >
              Sign in to launch
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void launch()}
              disabled={!ready || isDemo || !session.signAndSend}
              className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 text-[15px] font-extrabold text-white shadow-brand transition-[transform,opacity] duration-150 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-45"
            >
              {working ? (
                stage.label
              ) : (
                <>
                  <RocketIcon className="h-4 w-4" />
                  {symbol ? `Launch ${symbol}` : "Launch"}
                </>
              )}
            </button>
          )}

          <p className="mt-2 text-center text-[11px] font-medium leading-[1.45] text-faint">
            {isDemo
              ? "Demo mode cannot sign. Add a Privy app id to launch."
              : `About 0.01 SOL · one signature · listed on StonkFun, priced in ${quoteTicker}`}
          </p>
        </>
      )}
    </Modal>
  );
}

function Launched({mint, signature, onClose}: {mint: string; signature: string; onClose: () => void}) {
  return (
    <div className="text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--price-up-wash)] text-price-up">
        <CheckIcon className="h-6 w-6" />
      </span>
      <p className="mx-auto mt-3 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
        Your coin is on its bonding curve. It graduates into a pool once the curve
        fills.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Link
          href={`/stonk/${mint}`}
          onClick={onClose}
          className="flex h-[46px] items-center justify-center rounded-2xl bg-brand-500 text-[14px] font-extrabold text-white shadow-brand"
        >
          View your coin
        </Link>
        <div className="flex gap-2">
          <a
            href={launchpadFace("stonkfun").coinUrl(mint)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[40px] flex-1 items-center justify-center gap-1 rounded-2xl bg-[var(--overlay-wash)] text-[12.5px] font-bold text-muted hover:text-ink"
          >
            StonkFun <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
          <a
            href={txUrl(signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[40px] flex-1 items-center justify-center gap-1 rounded-2xl bg-[var(--overlay-wash)] text-[12.5px] font-bold text-muted hover:text-ink"
          >
            Transaction <ArrowUpRightIcon className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
