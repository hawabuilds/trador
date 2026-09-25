/**
 * Jupiter, for quotes and swap transactions.
 *
 * This is the whole execution layer. There is no program of Trador's own, no
 * router to deploy and audit, and — because Solana has no allowance model — no
 * approve step, so the two-signature state machine its EVM ancestor needed
 * collapses to one signature.
 *
 * The platform fee is the one part worth reading carefully. Jupiter takes
 * `platformFeeBps` on the quote and a `feeAccount` on the build, and the two
 * must always be sent together: a quote priced with a fee and a build without
 * one silently gives the fee away, and the reverse is rejected. They are
 * emitted as a pair here or not at all.
 */

import {type Pubkey} from "@/lib/pubkey";
import {FEE_BPS} from "@/config/fees";
import {FEE_COLLECTOR} from "@/lib/server/live/platformFee";
import {JUPITER_API_BASE, jupiterFetchHeaders} from "@/lib/server/live/jupiterEnv";

/** @deprecated Use `FEE_COLLECTOR` from `platformFee.ts`. */
export const FEE_WALLET = FEE_COLLECTOR;

export interface QuoteRequest {
  inputMint: Pubkey;
  outputMint: Pubkey;
  /** Base units of the input mint. */
  amount: string;
  slippageBps: number;
  /** The fee token account for the output mint, when one exists. */
  feeAccount?: Pubkey | null;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  /** Worst case at the requested slippage. */
  otherAmountThreshold: string;
  priceImpactPct: number;
  slippageBps: number;
  /** Present only when a fee was actually priced in. */
  platformFee: {amount: string; feeBps: number} | null;
  routeLabels: string[];
  /** Opaque payload the build step needs back verbatim. */
  raw: unknown;
}

export async function quote(request: QuoteRequest): Promise<SwapQuote> {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: String(request.slippageBps),
    restrictIntermediateTokens: "true",
  });

  // Fee params travel as a pair — see the note at the top of this file.
  if (request.feeAccount && FEE_BPS > 0) {
    params.set("platformFeeBps", String(FEE_BPS));
  }

  const response = await fetch(`${JUPITER_API_BASE}/swap/v1/quote?${params}`, {
    cache: "no-store",
    headers: jupiterFetchHeaders(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw jupiterHttpError(response.status, body, "price");
  }

  const body = (await response.json()) as Record<string, unknown>;

  const fee = body.platformFee as {amount?: string; feeBps?: number} | null | undefined;
  const plan = (body.routePlan ?? []) as {swapInfo?: {label?: string}}[];

  return {
    inputMint: String(body.inputMint ?? request.inputMint),
    outputMint: String(body.outputMint ?? request.outputMint),
    inAmount: String(body.inAmount ?? request.amount),
    outAmount: String(body.outAmount ?? "0"),
    otherAmountThreshold: String(body.otherAmountThreshold ?? "0"),
    priceImpactPct: Number(body.priceImpactPct ?? 0),
    slippageBps: Number(body.slippageBps ?? request.slippageBps),
    platformFee:
      fee?.amount != null
        ? {amount: String(fee.amount), feeBps: Number(fee.feeBps ?? FEE_BPS)}
        : null,
    routeLabels: plan
      .map((step) => step.swapInfo?.label)
      .filter((label): label is string => Boolean(label)),
    raw: body,
  };
}

export interface BuildRequest {
  quote: SwapQuote;
  userPublicKey: Pubkey;
  feeAccount?: Pubkey | null;
}

export interface BuiltSwap {
  /** Base64 `VersionedTransaction`, ready to be signed in the browser. */
  transactionBase64: string;
  lastValidBlockHeight: number | null;
  prioritizationFeeLamports: number | null;
}

export async function buildSwap(request: BuildRequest): Promise<BuiltSwap> {
  const response = await fetch(`${JUPITER_API_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: jupiterFetchHeaders({"content-type": "application/json"}),
    cache: "no-store",
    body: JSON.stringify({
      quoteResponse: request.quote.raw,
      userPublicKey: request.userPublicKey,
      ...(request.feeAccount ? {feeAccount: request.feeAccount} : {}),
      // SOL is wrapped and unwrapped around the swap so a user never has to
      // hold wSOL or know it exists.
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      // Let the router price priority against current congestion rather than
      // pinning a number that is wrong most of the day.
      prioritizationFeeLamports: {priorityLevelWithMaxLamports: {priorityLevel: "medium", maxLamports: 4_000_000}},
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw jupiterHttpError(response.status, body, "build");
  }

  const body = (await response.json()) as Record<string, unknown>;
  const transaction = body.swapTransaction;

  if (typeof transaction !== "string" || !transaction) {
    // Fail closed. Returning a half-built transaction is how a user ends up
    // signing something nobody checked.
    throw new Error("The router returned no transaction.");
  }

  return {
    transactionBase64: transaction,
    lastValidBlockHeight:
      typeof body.lastValidBlockHeight === "number" ? body.lastValidBlockHeight : null,
    prioritizationFeeLamports:
      typeof body.prioritizationFeeLamports === "number"
        ? body.prioritizationFeeLamports
        : null,
  };
}

/** Drop platform fee fields so build can run without a fee account (same route, no re-quote). */
export function quoteWithoutPlatformFee(quote: SwapQuote): SwapQuote {
  const raw = {...(quote.raw as Record<string, unknown>)};
  delete raw.platformFee;
  delete raw.platformFeeBps;
  return {...quote, platformFee: null, raw};
}

export function isJupiterRateLimitError(message: string): boolean {
  return /rate limited/i.test(message);
}

function jupiterHttpError(
  status: number,
  body: string,
  step: "price" | "build",
): Error {
  if (status === 429) {
    return new Error("The router is rate limited. Try again in a moment.");
  }
  const parsed =
    parseJupError(body) ??
    (step === "price"
      ? `Could not price this trade (${status}).`
      : `Could not build this transaction (${status}).`);
  return new Error(parsed);
}

/** Jupiter reports its own reasons in the body; surface them rather than a code. */
function parseJupError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {error?: string; errorCode?: string};
    if (parsed.error) {
      if (/no routes?/i.test(parsed.error)) {
        return "No route for this pair right now.";
      }
      return parsed.error;
    }
    return parsed.errorCode ?? null;
  } catch {
    return null;
  }
}
