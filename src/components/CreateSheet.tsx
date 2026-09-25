"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";

import {launchpadFace} from "@/config/launchpads";
import {txUrl} from "@/config/explorer";
import {useUser} from "@/hooks/useUser";
import {cn} from "@/lib/cn";
import {confirmSignature} from "@/lib/confirmSignature";
import {compact} from "@/lib/format";
import {useSession} from "@/lib/session";
import {stocksByPopularity} from "@/lib/stocks/registry";
import {ImageCropper} from "./ImageCropper";
import {ArrowUpRightIcon, CheckIcon, RocketIcon} from "./ui/Icons";
import {Modal} from "./ui/Modal";

/**
 * Launch a coin priced in a stock, on StonkFun or pump.fun, from one pop-up.
 *
 * Laid out like the order ticket and the same width. The form is short on
 * purpose — picture, name, ticker, the stock it is priced in, the launchpad's
 * one real choice, and an optional dev buy — and underneath it, before any
 * button is pressed, the whole bill: every fee, every deposit, what the dev buy
 * swaps and receives, and the total. All of it is a mainnet simulation, redone
 * whenever the form changes (`/api/launch/preview`).
 *
 * The button does the rest. With no dev buy, or when the wallet already holds
 * the stock, that is one signature. When the dev buy needs SOL swapped into the
 * stock first it is two — a launch and a swap cannot fit in one Solana
 * transaction — and the form says so before it is pressed rather than after.
 */

type Launchpad = "stonkfun" | "pumpfun";

type Stage =
  | {kind: "idle"}
  | {kind: "working"; label: string}
  | {kind: "done"; mint: string; signature: string; symbol: string; launchpad: Launchpad}
  | {kind: "failed"; message: string};

interface LaunchOptionsResponse {
  stonkfun: {available: boolean; tickers: string[]; holderRewardBps: number[]};
  pumpfun: {
    available: boolean;
    tickers: string[];
    creatorFeeConfigurable: boolean;
    maxCreatorFeeBps: number;
    holderRewardEnabled: boolean;
  };
}

interface CostLine {
  key: string;
  label: string;
  lamports: number;
  note: string;
}

interface Preview {
  launchpad: Launchpad;
  launchCosts: CostLine[];
  launchLamports: number;
  swap: {
    solIn: number;
    stockOut: number;
    stockMinOut: number;
    priceImpactPct: number;
    route: string[];
    overheadLamports: number;
  } | null;
  devBuy: {
    stockIn: number;
    stockTicker: string;
    tokensOut: number;
    supplyPct: number;
    tradingFeeStock: number;
    tradingFeeBps: number;
  } | null;
  devBuyStock: string;
  totalLamports: number;
  balanceLamports: number;
  signatures: 1 | 2;
  stockTicker: string;
  solUsd: number | null;
}

const LAUNCHPADS: {value: Launchpad; label: string}[] = [
  {value: "stonkfun", label: "StonkFun"},
  {value: "pumpfun", label: "pump.fun"},
];

const DEV_BUY_PRESETS = ["0.1", "0.5", "1"];

/** SOL with as many decimals as it takes to show a small fee honestly. */
function sol(lamports: number): string {
  const value = lamports / 1e9;
  if (value === 0) return "0 SOL";
  if (value >= 1) return `${value.toFixed(3)} SOL`;
  if (value >= 0.01) return `${value.toFixed(4)} SOL`;
  return `${value.toPrecision(2)} SOL`;
}

function amount(value: number): string {
  if (value >= 1000) return compact(value);
  if (value >= 1) return value.toFixed(3);
  return value.toPrecision(3);
}

function usd(lamports: number, solUsd: number | null): string | null {
  if (!solUsd) return null;
  const value = (lamports / 1e9) * solUsd;
  return value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}

/** Read a picked file as a data URL. */
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

async function postJson<T>(url: string, token: string, body: unknown): Promise<{ok: boolean; status: number; body: T}> {
  const response = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json", authorization: `Bearer ${token}`},
    body: JSON.stringify(body),
  });
  return {ok: response.ok, status: response.status, body: (await response.json()) as T};
}

export function CreateSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const {authenticated, wallet, login, isDemo} = useUser();
  const session = useSession();

  const [launchpad, setLaunchpad] = useState<Launchpad>("stonkfun");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [quoteTicker, setQuoteTicker] = useState("NVDAx");
  const [search, setSearch] = useState("");
  const [feeBps, setFeeBps] = useState(100);
  const [holderReward, setHolderReward] = useState(true);
  const [creatorFeeBps, setCreatorFeeBps] = useState(100);
  const [devBuy, setDevBuy] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState({twitter: "", telegram: "", website: ""});
  const [stage, setStage] = useState<Stage>({kind: "idle"});
  const fileRef = useRef<HTMLInputElement>(null);

  // A fresh form each time it opens after a launch, not the last coin's.
  useEffect(() => {
    if (open && stage.kind === "done") {
      setName("");
      setSymbol("");
      setImage(null);
      setDevBuy("");
      setDescription("");
      setLinks({twitter: "", telegram: "", website: ""});
      setStage({kind: "idle"});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options = useQuery({
    queryKey: ["launch-options"],
    enabled: open,
    staleTime: 300_000,
    queryFn: async (): Promise<LaunchOptionsResponse> => {
      const response = await fetch("/api/launch/options");
      if (!response.ok) throw new Error("Could not load the launchpads.");
      return (await response.json()) as LaunchOptionsResponse;
    },
  });

  const pad = options.data?.[launchpad];
  const pump = options.data?.pumpfun;

  // The stocks this launchpad will actually accept, filtered by the search.
  const stocks = useMemo(() => {
    const accepted = pad ? new Set(pad.tickers) : null;
    const query = search.trim().toLowerCase();
    return stocksByPopularity().filter(
      (stock) =>
        (!accepted || accepted.has(stock.ticker)) &&
        (!query ||
          stock.ticker.toLowerCase().includes(query) ||
          stock.name.toLowerCase().includes(query)),
    );
  }, [pad, search]);

  // Switching launchpad can leave the chosen stock unsupported; move to the
  // first one that is, rather than letting the launch fail later.
  useEffect(() => {
    if (pad && pad.tickers.length > 0 && !pad.tickers.includes(quoteTicker)) {
      setQuoteTicker(pad.tickers[0]);
    }
  }, [pad, quoteTicker]);

  const pumpFeeChoices = useMemo(
    () => [100, 200, 300].filter((bps) => bps <= (pump?.maxCreatorFeeBps ?? 0)),
    [pump?.maxCreatorFeeBps],
  );

  const devBuySol = Number(devBuy || "0");
  const devBuyValid = Number.isFinite(devBuySol) && devBuySol >= 0;
  const formReady = name.trim().length > 0 && /^[A-Z0-9]{1,10}$/.test(symbol) && devBuyValid;

  const form = {
    launchpad,
    name: name.trim(),
    symbol,
    quoteTicker,
    feeBps,
    holderReward: launchpad === "pumpfun" ? holderReward && Boolean(pump?.holderRewardEnabled) : false,
    creatorFeeBps: launchpad === "pumpfun" && pump?.creatorFeeConfigurable ? creatorFeeBps : 0,
    devBuySol: devBuyValid ? devBuySol : 0,
    creator: wallet,
  };

  // The bill, re-simulated whenever the form settles for a moment.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const formKey = JSON.stringify(form);
  useEffect(() => {
    if (!open || !formReady || !wallet || isDemo) {
      setPreviewKey(null);
      return;
    }
    const timer = window.setTimeout(() => setPreviewKey(formKey), 650);
    return () => window.clearTimeout(timer);
  }, [open, formReady, wallet, isDemo, formKey]);

  const preview = useQuery({
    queryKey: ["launch-preview", previewKey],
    enabled: previewKey !== null && stage.kind !== "working",
    staleTime: 20_000,
    retry: false,
    placeholderData: (previous) => previous,
    queryFn: async (): Promise<Preview> => {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in again to see the cost.");
      const result = await postJson<Preview & {error?: string}>("/api/launch/preview", token, JSON.parse(previewKey!));
      if (!result.ok) throw new Error(result.body.error ?? "Could not price this launch.");
      return result.body;
    },
  });

  const bill = preview.data && previewKey === formKey ? preview.data : null;
  const settling = formReady && !isDemo && (previewKey !== formKey || preview.isFetching);
  const working = stage.kind === "working";
  const short = bill ? bill.balanceLamports < bill.totalLamports : false;
  const ready = formReady && image !== null && !working && bill !== null && !short && !settling;

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      const data = await readFile(file);
      if (!/^data:image\/(png|jpeg|webp|gif)/.test(data)) throw new Error("Use a PNG, JPEG, WebP or GIF image.");
      // An animated GIF keeps its animation; cropping through a canvas would
      // flatten it to one frame.
      if (file.type === "image/gif") setImage(data);
      else setCropSource(data);
    } catch (error) {
      setStage({kind: "failed", message: (error as Error).message});
    }
  }

  async function launch() {
    if (!ready || !wallet || !session.signAndSend || !bill) return;
    let swapped = false;
    // What the launch spends on the dev buy. After a swap, the floor of the
    // swap that actually ran — the preview's quote may be a few seconds old.
    let devBuyStock = bill.devBuyStock;

    try {
      const token = await session.getAccessToken();
      if (!token) throw new Error("Sign in again to launch.");

      // 1. SOL into the stock, when the dev buy needs it.
      if (bill.signatures === 2) {
        setStage({kind: "working", label: `Approve the ${bill.stockTicker} swap (1 of 2)…`});
        const swap = await postJson<{transaction?: string; stockMinOut?: string; error?: string}>(
          "/api/launch/swap",
          token,
          form,
        );
        if (!swap.ok || !swap.body.transaction) throw new Error(swap.body.error ?? "Could not route the dev buy.");
        const swapSignature = await session.signAndSend(
          Uint8Array.from(atob(swap.body.transaction), (c) => c.charCodeAt(0)),
        );
        setStage({kind: "working", label: `Buying ${bill.stockTicker}…`});
        if ((await confirmSignature(swapSignature)) === "failed") {
          throw new Error("The swap failed on-chain. Nothing was spent beyond the network fee.");
        }
        swapped = true;
        if (swap.body.stockMinOut) devBuyStock = swap.body.stockMinOut;
      }

      // 2. The launch itself, with the dev buy inside it. Retried briefly while
      // the swapped stock becomes visible to the server.
      setStage({kind: "working", label: "Preparing your launch…"});
      type Built = {transaction?: string; mint?: string; pool?: string; image?: string; error?: string; retry?: boolean};
      let built: {ok: boolean; body: Built} | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        built = await postJson<Built>("/api/launch/build", token, {
          ...form,
          devBuyStock,
          image,
          description: description.trim(),
          ...links,
        });
        if (built.ok || !built.body.retry) break;
        setStage({kind: "working", label: built.body.error ?? "Waiting for the swap to settle…"});
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!built?.ok || !built.body.transaction || !built.body.mint || !built.body.pool) {
        throw new Error(built?.body.error ?? "Could not prepare the launch.");
      }

      setStage({
        kind: "working",
        label: bill.signatures === 2 ? "Approve the launch (2 of 2)…" : "Approve in your wallet…",
      });
      const signature = await session.signAndSend(
        Uint8Array.from(atob(built.body.transaction), (c) => c.charCodeAt(0)),
      );

      setStage({kind: "working", label: "Launching on-chain…"});
      if ((await confirmSignature(signature)) === "failed") {
        throw new Error("The launch was rejected on-chain. Nothing was created.");
      }

      // Register it so its page exists now, not whenever the indexer reaches it.
      // One attempt is not enough: the signature can be confirmed on the node
      // the browser asked while the server's read still misses the new pool,
      // and swallowing that miss is how "View your coin" opens a 404.
      setStage({kind: "working", label: "Opening your coin page…"});
      const registration = {
        launchpad,
        mint: built.body.mint,
        pool: built.body.pool,
        quoteTicker,
        name: name.trim(),
        symbol,
        image: built.body.image,
        signature,
      };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const confirmed = await postJson<{ok?: boolean; error?: string}>(
          "/api/launch/confirm",
          token,
          registration,
        ).catch(() => null);
        if (confirmed?.ok) break;
        const terminal = confirmed !== null && (confirmed.status === 400 || confirmed.status === 401 || confirmed.status === 409);
        if (terminal || attempt === 5) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      setStage({kind: "done", mint: built.body.mint, signature, symbol, launchpad});
    } catch (error) {
      const message = (error as Error).message ?? "The launch failed.";
      const cancelled = /reject|denied|cancel/i.test(message);
      setStage({
        kind: "failed",
        message:
          (cancelled ? "You cancelled the signature." : message) +
          (swapped ? ` Your SOL was swapped to ${bill.stockTicker} and is in your wallet.` : ""),
      });
    }
  }

  const title =
    stage.kind === "done" ? `${stage.symbol} is live` : cropSource ? "Crop image" : "Launch a coin";

  return (
    <Modal
      open={open}
      onClose={working ? () => undefined : onClose}
      surface="popup"
      title={title}
      className="max-w-[352px] p-5 pt-5"
    >
      {stage.kind === "done" ? (
        <Launched
          mint={stage.mint}
          signature={stage.signature}
          launchpad={stage.launchpad}
          onClose={onClose}
        />
      ) : cropSource ? (
        <ImageCropper
          source={cropSource}
          onCancel={() => setCropSource(null)}
          onDone={(data) => {
            setImage(data);
            setCropSource(null);
          }}
        />
      ) : (
        <>
          {/* Where it launches. */}
          <div className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[3px]">
            {LAUNCHPADS.map((entry) => {
              const unavailable = options.data ? !options.data[entry.value].available : false;
              return (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={launchpad === entry.value}
                  disabled={unavailable || working}
                  onClick={() => setLaunchpad(entry.value)}
                  className={cn(
                    "flex-1 rounded-full py-1.5 text-[12.5px] font-extrabold transition-colors disabled:opacity-40",
                    launchpad === entry.value
                      ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                      : "text-faint hover:text-muted",
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-3">
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={image ? "Change the image" : "Choose an image"}
                className="grid h-[76px] w-[76px] place-items-center overflow-hidden rounded-2xl bg-[var(--bg-input)] text-[11px] font-bold text-faint shadow-inset-soft transition-colors hover:text-muted"
              >
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-full w-full object-cover" />
                ) : (
                  "Image"
                )}
              </button>
              {image && !image.startsWith("data:image/gif") ? (
                <button
                  type="button"
                  onClick={() => setCropSource(image)}
                  className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-surface-popup px-2 py-0.5 text-[10px] font-extrabold text-muted shadow-panel hover:text-ink"
                >
                  Crop
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                void pickImage(event.target.files?.[0]);
                event.target.value = "";
              }}
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

          {/* The stock it is priced in, searchable. */}
          <div className="mb-1.5 mt-3.5 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-faint">Priced in</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search stocks"
              aria-label="Search stocks"
              className="h-[26px] w-[140px] rounded-full bg-[var(--bg-input)] px-3 text-[11.5px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
            />
          </div>
          <div className="rail -mx-5 flex gap-1.5 overflow-x-auto overscroll-x-contain px-5">
            {stocks.length === 0 ? (
              <span className="py-1.5 text-[12px] font-semibold text-faint">
                {options.isLoading ? "Loading stocks…" : `No match on ${launchpadFace(launchpad).label}`}
              </span>
            ) : (
              stocks.map((stock) => {
                const active = stock.ticker === quoteTicker;
                return (
                  <button
                    key={stock.mint}
                    type="button"
                    title={stock.name}
                    onClick={() => setQuoteTicker(stock.ticker)}
                    aria-pressed={active}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-[12px] font-extrabold transition-colors",
                      active ? "bg-brand-500 text-white" : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                    )}
                  >
                    {stock.ticker}
                  </button>
                );
              })
            )}
          </div>

          {/* The launchpad's own choice. */}
          {launchpad === "stonkfun" ? (
            <OptionRow label="Holder reward" hint="A fee on every transfer, paid to holders">
              <Segments
                values={options.data?.stonkfun.holderRewardBps ?? [100, 300]}
                value={feeBps}
                onChange={setFeeBps}
                format={(bps) => `${bps / 100}%`}
              />
            </OptionRow>
          ) : (
            <>
              {pump?.creatorFeeConfigurable && pumpFeeChoices.length > 0 ? (
                <OptionRow label="Creator fee" hint="Taken on every trade on the curve">
                  <Segments
                    values={pumpFeeChoices}
                    value={creatorFeeBps}
                    onChange={setCreatorFeeBps}
                    format={(bps) => `${bps / 100}%`}
                  />
                </OptionRow>
              ) : null}
              {pump?.holderRewardEnabled ? (
                <OptionRow label="Creator fees go to" hint={holderReward ? "Paid out to holders" : "Paid to your wallet"}>
                  <Segments
                    values={[1, 0]}
                    value={holderReward ? 1 : 0}
                    onChange={(value) => setHolderReward(value === 1)}
                    format={(value) => (value === 1 ? "Holders" : "Me")}
                  />
                </OptionRow>
              ) : null}
            </>
          )}

          {/* Buying your own coin in the same click. */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-faint">Dev buy</div>
              <div className="text-[10.5px] font-medium text-faint">Optional · buy first, at launch price</div>
            </div>
            <div className="flex items-center gap-1">
              {DEV_BUY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setDevBuy(devBuy === preset ? "" : preset)}
                  className={cn(
                    "rounded-full px-2 py-1 text-[11px] font-extrabold transition-colors",
                    devBuy === preset ? "bg-brand-500 text-white" : "bg-[var(--overlay-wash)] text-muted hover:text-ink",
                  )}
                >
                  {preset}
                </button>
              ))}
              <div className="flex h-[28px] w-[74px] items-center rounded-full bg-[var(--bg-input)] pr-2 shadow-inset-soft focus-within:shadow-inset-focus">
                <input
                  value={devBuy}
                  inputMode="decimal"
                  onChange={(event) => setDevBuy(event.target.value.replace(/[^0-9.]/g, "").slice(0, 8))}
                  placeholder="0"
                  aria-label="Dev buy in SOL"
                  className="w-full min-w-0 bg-transparent pl-2.5 text-right text-[12px] font-bold text-ink outline-none placeholder:text-faint"
                />
                <span className="pl-1 text-[10px] font-bold text-faint">SOL</span>
              </div>
            </div>
          </div>

          {showMore ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, 280))}
                placeholder="Description (optional)"
                aria-label="Description"
                rows={2}
                className="resize-none rounded-xl bg-[var(--bg-input)] px-3 py-2 text-[12.5px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
              />
              {(["twitter", "telegram", "website"] as const).map((key) => (
                <input
                  key={key}
                  value={links[key]}
                  onChange={(event) => setLinks({...links, [key]: event.target.value})}
                  placeholder={
                    key === "twitter" ? "https://x.com/…" : key === "telegram" ? "https://t.me/…" : "https://…"
                  }
                  aria-label={key}
                  className="h-[32px] rounded-xl bg-[var(--bg-input)] px-3 text-[12.5px] font-semibold text-ink shadow-inset-soft outline-none placeholder:text-faint focus:shadow-inset-focus"
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="mt-2.5 text-[12px] font-bold text-faint transition-colors hover:text-accent-link"
            >
              + Description & links
            </button>
          )}

          {authenticated && !isDemo ? (
            <Bill
              bill={bill}
              settling={settling}
              error={formReady && !settling ? ((preview.error as Error | null)?.message ?? null) : null}
              formReady={formReady}
              launchpadLabel={launchpadFace(launchpad).label}
              symbol={symbol}
            />
          ) : null}

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
                  {!image && formReady
                    ? "Add an image to launch"
                    : short
                      ? "Not enough SOL"
                      : `Launch${symbol ? ` ${symbol}` : ""}${bill?.devBuy ? " + buy" : ""}`}
                </>
              )}
            </button>
          )}

          <p className="mt-2 text-center text-[11px] font-medium leading-[1.45] text-faint">
            {isDemo
              ? "Demo mode cannot sign. Add a Privy app id to launch."
              : bill?.signatures === 2
                ? `Two approvals: SOL → ${bill.stockTicker} for the dev buy, then the launch`
                : `One approval · listed on ${launchpadFace(launchpad).label}, priced in ${quoteTicker}`}
          </p>
        </>
      )}
    </Modal>
  );
}

function OptionRow({label, hint, children}: {label: string; hint: string; children: React.ReactNode}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-faint">{label}</div>
        <div className="truncate text-[10.5px] font-medium text-faint">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Segments<T extends number>({
  values,
  value,
  onChange,
  format,
}: {
  values: T[];
  value: T;
  onChange: (value: T) => void;
  format: (value: T) => string;
}) {
  return (
    <div className="flex shrink-0 gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]">
      {values.map((entry) => (
        <button
          key={entry}
          type="button"
          aria-pressed={value === entry}
          onClick={() => onChange(entry)}
          className={cn(
            "rounded-full px-3 py-1 text-[11.5px] font-extrabold transition-colors",
            value === entry ? "bg-[var(--bg-input)] text-ink shadow-tab-active" : "text-faint hover:text-muted",
          )}
        >
          {format(entry)}
        </button>
      ))}
    </div>
  );
}

/**
 * The whole bill, line by line, before anything is signed.
 *
 * Every figure is from a mainnet simulation of this exact launch. The lines are
 * the parts of the total and add up to it; nothing is left in a "misc" bucket.
 */
function Bill({
  bill,
  settling,
  error,
  formReady,
  launchpadLabel,
  symbol,
}: {
  bill: Preview | null;
  settling: boolean;
  error: string | null;
  formReady: boolean;
  launchpadLabel: string;
  symbol: string;
}) {
  if (!formReady) {
    return (
      <p className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 text-[11.5px] font-medium text-faint shadow-inset-soft">
        Add a name and ticker to see the full cost.
      </p>
    );
  }
  if (error && !bill) {
    return (
      <p role="alert" className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 text-[12px] font-semibold leading-[1.45] text-error shadow-inset-soft">
        {error}
      </p>
    );
  }
  if (!bill) {
    return (
      <div className="mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 text-[11.5px] font-medium text-faint shadow-inset-soft">
        Simulating on mainnet…
      </div>
    );
  }

  const short = bill.balanceLamports < bill.totalLamports;

  return (
    <div
      className={cn(
        "mt-3 rounded-2xl bg-[var(--segment-track)] px-3 py-2.5 shadow-inset-soft transition-opacity",
        settling && "opacity-60",
      )}
    >
      <Section title="Launch">
        {bill.launchCosts.map((line) => (
          <Line
            key={line.key}
            label={line.label}
            note={line.note}
            value={line.key === "launchpad" && line.lamports === 0 ? "Free" : sol(line.lamports)}
          />
        ))}
      </Section>

      {bill.devBuy ? (
        <Section title="Dev buy">
          {bill.swap ? (
            <>
              <Line
                label={`Swap to ${bill.stockTicker}`}
                note={`At least ${amount(bill.swap.stockMinOut)} ${bill.stockTicker} after 1% slippage`}
                value={`${bill.swap.solIn} SOL → ${amount(bill.swap.stockOut)}`}
              />
              <Line
                label="Swap fees"
                note="Network and priority fee, plus a token account if you don't have one"
                value={sol(bill.swap.overheadLamports)}
              />
              <Line
                label="Price impact"
                note={bill.swap.route.length ? `Routed via ${bill.swap.route.join(" → ")}` : "Routed by Jupiter"}
                value={`${bill.swap.priceImpactPct.toFixed(2)}%`}
              />
            </>
          ) : (
            <Line
              label={`Spends your ${bill.stockTicker}`}
              note="Already in your wallet, so no swap is needed"
              value={`${amount(bill.devBuy.stockIn)} ${bill.stockTicker}`}
            />
          )}
          <Line
            label={`${launchpadLabel} trading fee`}
            note="Taken from the buy by the launchpad"
            value={`${amount(bill.devBuy.tradingFeeStock)} ${bill.stockTicker} · ${(bill.devBuy.tradingFeeBps / 100).toFixed(2)}%`}
          />
          <Line
            label="You receive"
            note="Simulated on the new curve at launch price"
            value={`≈${compact(bill.devBuy.tokensOut)} ${symbol} · ${bill.devBuy.supplyPct.toFixed(2)}%`}
            strong
          />
        </Section>
      ) : null}

      <Line label="Trador fee" note="Trador takes nothing on a launch" value="None" />

      <div className="mt-2 flex items-baseline justify-between border-t border-[var(--overlay-wash-hover)] pt-2">
        <span className="text-[12.5px] font-extrabold text-ink">Total</span>
        <span className="tabular-nums text-right">
          <span className="text-[13.5px] font-extrabold text-ink">{sol(bill.totalLamports)}</span>
          {usd(bill.totalLamports, bill.solUsd) ? (
            <span className="ml-1 text-[11px] font-semibold text-faint">≈ {usd(bill.totalLamports, bill.solUsd)}</span>
          ) : null}
        </span>
      </div>
      <div className={cn("mt-0.5 text-right text-[10.5px] font-semibold tabular-nums", short ? "text-error" : "text-faint")}>
        {short ? "Not enough SOL · " : ""}Wallet holds {sol(bill.balanceLamports)}
      </div>
    </div>
  );
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="mb-1.5">
      <div className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.09em] text-faint">{title}</div>
      {children}
    </div>
  );
}

function Line({label, note, value, strong}: {label: string; note: string; value: string; strong?: boolean}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[2px]" title={note}>
      <span className="min-w-0 truncate text-[11.5px] font-semibold text-muted">{label}</span>
      <span className={cn("shrink-0 tabular-nums text-[11.5px]", strong ? "font-extrabold text-ink" : "font-bold text-ink")}>
        {value}
      </span>
    </div>
  );
}

function Launched({
  mint,
  signature,
  launchpad,
  onClose,
}: {
  mint: string;
  signature: string;
  launchpad: Launchpad;
  onClose: () => void;
}) {
  const face = launchpadFace(launchpad);
  return (
    <div className="text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--price-up-wash)] text-price-up">
        <CheckIcon className="h-6 w-6" />
      </span>
      <p className="mx-auto mt-3 max-w-[30ch] text-[13px] leading-[1.5] text-muted">
        Your coin is on its bonding curve. It graduates into a pool once the curve fills.
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
            href={face.coinUrl(mint)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[40px] flex-1 items-center justify-center gap-1 rounded-2xl bg-[var(--overlay-wash)] text-[12.5px] font-bold text-muted hover:text-ink"
          >
            {face.label} <ArrowUpRightIcon className="h-3.5 w-3.5" />
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
