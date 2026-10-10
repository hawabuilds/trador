/**
 * The money side of a trade: what a buy spends and a sell pays out.
 *
 * SOL is native — wrapped and unwrapped around the swap, so nobody has to know
 * wSOL exists — and USDC is an ordinary token. Which of the two is in play is
 * one choice, because it is one decision: nobody wants to pay in SOL and be
 * paid in USDC on the same screen.
 *
 * Kept out of the ticket so the rules that decide whether a trade can be
 * afforded are testable without rendering anything.
 */

import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {spendableLamports} from "@/lib/amounts";

export type SettleMint = "sol" | "usdc";

export interface Money {
  mint: string;
  symbol: string;
  decimals: number;
}

export const SOL: Money = {mint: WSOL_MINT, symbol: "SOL", decimals: 9};
export const USDC: Money = {mint: USDC_MINT, symbol: "USDC", decimals: 6};

export const MONEY: Record<SettleMint, Money> = {sol: SOL, usdc: USDC};

/**
 * SOL a trade funded in something else still needs, for its network fee and
 * possibly rent on a token account it opens. There is no fee sponsorship, so a
 * wallet below this cannot pay for the transaction it is about to be asked to
 * sign.
 */
export const MIN_FEE_LAMPORTS = 3_000_000n; // 0.003 SOL

/**
 * The most this side of the ticket can commit, in base units.
 *
 * A SOL buy keeps a little back, because the balance being spent is also the
 * balance that pays for the transaction. A USDC buy does not — USDC pays for
 * nothing on Solana — so it can be spent to the last unit, and the SOL needed
 * for fees is a separate check. A sell is limited by the position.
 */
export function spendableBalance(params: {
  buying: boolean;
  settleMint: SettleMint;
  lamports: bigint | null;
  usdc: bigint | null;
  held: bigint | null;
}): bigint | null {
  if (!params.buying) return params.held;
  if (params.settleMint === "usdc") return params.usdc;
  return params.lamports === null ? null : spendableLamports(params.lamports);
}

/**
 * Whether the wallet is too short of SOL to pay for the transaction.
 *
 * True for every trade that is not itself funded in SOL — a USDC buy from a
 * wallet holding no SOL fails at signing, which is the worst moment to find
 * out. A SOL buy is covered by the reserve in `spendableBalance` instead.
 */
export function shortOfNetworkFees(params: {
  buying: boolean;
  settleMint: SettleMint;
  lamports: bigint | null;
}): boolean {
  if (params.lamports === null) return false;
  if (params.buying && params.settleMint === "sol") return false;
  return params.lamports < MIN_FEE_LAMPORTS;
}

/**
 * What a sell pays out, from the router's base units.
 *
 * Takes the decimals from the money rather than assuming SOL's nine, which is
 * the one thing that silently goes wrong when a payout currency is added: a
 * USDC payout read as lamports is a thousand times too small.
 */
export function moneyReceived(outAmount: string, money: Money): number {
  return Number(outAmount) / 10 ** money.decimals;
}

/** Why an amount is more than the wallet can cover, in the unit being typed. */
export function overBalanceMessage(params: {
  buying: boolean;
  available: number;
  symbol: string;
  /** Whether some of the balance is held back to pay network fees. */
  reserved: boolean;
  format: (value: number) => string;
}): string {
  const {buying, available, symbol, reserved, format} = params;
  if (available === 0) return `You don't hold any ${symbol} in this wallet.`;
  if (!buying) return `You only hold ${format(available)} ${symbol}.`;
  return reserved
    ? `You can spend up to ${format(available)} ${symbol} — a little is kept back for network fees.`
    : `You can spend up to ${format(available)} ${symbol}.`;
}
