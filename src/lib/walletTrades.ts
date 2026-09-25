/**
 * A wallet's trades, and what its holdings cost.
 *
 * Pure, and safe for the browser: the server parses and stores trades with
 * these rules, and the Stonkfolio works out profit with them.
 *
 * **Trades come from the wallet's own balance changes, not the provider's
 * label.** A real ALLINU buy was labelled TRANSFER and its sell
 * INITIALIZE_ACCOUNT. What the wallet gained and lost is unambiguous:
 *
 *   - Tokens: the net change of every token account the wallet owns, per mint.
 *     Wrapped SOL is folded into SOL.
 *   - SOL: the wallet's lamport change, with the network fee added back and
 *     rent deposited into (or refunded from) its own token accounts removed —
 *     opening a token account costs ~0.002 SOL that the wallet gets back when
 *     it closes, and neither is the price of the coin. On the real buy above
 *     that leaves exactly 0.05 SOL.
 *   - A trade needs something in and something out. A deposit is not a trade.
 */

import type {ParsedTx} from "@/lib/server/live/helius";
import {samePubkey} from "@/lib/pubkey";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  USDC_MINT,
  WSOL_MINT,
} from "./programs";

export const SOL_MINT: string = WSOL_MINT;
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLES = new Set<string>([USDC_MINT, USDT_MINT]);
/** Assets a trade is paid in rather than for. Never given a position. */
export const BASE_MINTS = new Set<string>([SOL_MINT, ...STABLES]);

/**
 * SOL moving alongside a token-for-token swap below this is fees, tips or rent
 * the adjustment above could not see — not what the tokens were paid with.
 */
const SOL_NOISE = 0.003;

export interface RawTrade {
  signature: string;
  /** ISO time. */
  at: string;
  mint: string;
  side: "buy" | "sell";
  amount: number;
  paidMint: string;
  paidAmount: number;
}

export interface WalletTrade extends RawTrade {
  /** Null when the paid side had no known dollar price at the time. */
  valueUsd: number | null;
  priceUsd: number | null;
}

interface Leg {
  mint: string;
  amount: number;
}

/** Which opposite leg a trade was paid with: stables, then SOL, then the largest. */
function pickPaid(legs: Leg[]): Leg | null {
  return (
    legs.find((leg) => STABLES.has(leg.mint)) ??
    legs.find((leg) => leg.mint === SOL_MINT) ??
    [...legs].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0] ??
    null
  );
}

/** SPL Token `CloseAccount` is instruction 9, which base58-encodes as "A". */
const CLOSE_ACCOUNT_DATA = "A";

/**
 * Token accounts this transaction opened or closed for the wallet, by mint
 * where known.
 *
 * An account opened empty never shows a balance change, so the balance data
 * alone cannot say it is the wallet's — and the rent paid into it then looks
 * like the price of whatever arrived. A stonk.fun launcher claiming pool fees
 * paid 0.0015748 SOL to open such an account and would otherwise have been
 * recorded as buying $2,856 of stock for fifteen cents. The instructions say
 * whose account it is, including when a router opens it on the wallet's behalf.
 */
function ownAccountsFromInstructions(tx: ParsedTx, wallet: string): Map<string, string | null> {
  const found = new Map<string, string | null>();
  const visit = (ix: {programId: string; accounts: string[]; data?: string}) => {
    if (ix.programId === ASSOCIATED_TOKEN_PROGRAM && ix.accounts[2] === wallet && ix.accounts[1]) {
      found.set(ix.accounts[1], ix.accounts[3] ?? null);
    }
    if (
      (ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM) &&
      ix.data === CLOSE_ACCOUNT_DATA &&
      ix.accounts[2] === wallet &&
      ix.accounts[0]
    ) {
      if (!found.has(ix.accounts[0])) found.set(ix.accounts[0], null);
    }
  };
  for (const ix of tx.instructions ?? []) {
    visit(ix);
    for (const inner of ix.innerInstructions ?? []) visit(inner);
  }
  return found;
}

export function tradesFromTx(tx: ParsedTx, wallet: string): RawTrade[] {
  if (tx.transactionError) return [];

  const tokens = new Map<string, number>();
  const ownTokenAccounts = new Map<string, string>(); // account -> mint
  let lamports = 0;
  let wrappedSol = 0;

  for (const account of tx.accountData ?? []) {
    if (account.account === wallet) lamports += account.nativeBalanceChange ?? 0;
    for (const change of account.tokenBalanceChanges ?? []) {
      if (change.userAccount !== wallet) continue;
      const amount = Number(change.rawTokenAmount.tokenAmount) / 10 ** change.rawTokenAmount.decimals;
      ownTokenAccounts.set(change.tokenAccount, change.mint);
      if (change.mint === SOL_MINT) wrappedSol += amount;
      else tokens.set(change.mint, (tokens.get(change.mint) ?? 0) + amount);
    }
  }

  for (const [account, mint] of ownAccountsFromInstructions(tx, wallet)) {
    if (!ownTokenAccounts.has(account)) ownTokenAccounts.set(account, mint ?? "");
  }

  // Rent in and out of the wallet's own token accounts is not a price. Wrapped
  // SOL accounts are skipped: their lamports are the balance itself, which the
  // token change above already counted.
  for (const account of tx.accountData ?? []) {
    if (!account.account || account.account === wallet) continue;
    const mint = ownTokenAccounts.get(account.account);
    if (mint !== undefined && mint !== SOL_MINT) lamports += account.nativeBalanceChange ?? 0;
  }
  if (tx.feePayer === wallet) lamports += tx.fee ?? 0;

  const sol = lamports / 1e9 + wrappedSol;
  const legs: Leg[] = [...tokens]
    .filter(([, amount]) => amount !== 0 && Number.isFinite(amount))
    .map(([mint, amount]) => ({mint, amount}));

  const opposed = legs.some((leg) => leg.amount > 0) && legs.some((leg) => leg.amount < 0);
  if (Math.abs(sol) >= (opposed ? SOL_NOISE : 1e-9)) legs.push({mint: SOL_MINT, amount: sol});

  const ins = legs.filter((leg) => leg.amount > 0);
  const outs = legs.filter((leg) => leg.amount < 0);
  if (ins.length === 0 || outs.length === 0) return [];

  const at = new Date(tx.timestamp * 1000).toISOString();
  const make = (asset: Leg, paid: Leg): RawTrade => ({
    signature: tx.signature,
    at,
    mint: asset.mint,
    side: asset.amount > 0 ? "buy" : "sell",
    amount: Math.abs(asset.amount),
    paidMint: paid.mint,
    paidAmount: Math.abs(paid.amount),
  });

  const assets = legs.filter((leg) => !BASE_MINTS.has(leg.mint));
  if (assets.length === 0) {
    // SOL for USDC and the like: record what was received.
    const paid = pickPaid(outs);
    return paid ? [make(ins[0], paid)] : [];
  }

  const trades: RawTrade[] = [];
  for (const asset of assets) {
    const paid = pickPaid((asset.amount > 0 ? outs : ins).filter((leg) => leg !== asset));
    if (paid) trades.push(make(asset, paid));
  }
  return trades;
}

/**
 * Dollar value of a trade at the time, given SOL's price then.
 *
 * Stables are worth their face; SOL at its price that minute; verified stocks
 * at the spot passed in `mintUsd` (pool aggregate at sync time). Anything else
 * is left null rather than guessed.
 */
export function valueTrade(
  trade: RawTrade,
  solUsd: number | null,
  mintUsd: ReadonlyMap<string, number> = new Map(),
): WalletTrade {
  let valueUsd: number | null = null;
  if (STABLES.has(trade.paidMint)) valueUsd = trade.paidAmount;
  else if (STABLES.has(trade.mint)) valueUsd = trade.amount;
  else if (trade.paidMint === SOL_MINT && solUsd !== null) valueUsd = trade.paidAmount * solUsd;
  else if (trade.mint === SOL_MINT && solUsd !== null) valueUsd = trade.amount * solUsd;
  else {
    const paid = mintUsd.get(trade.paidMint);
    if (paid !== undefined) valueUsd = trade.paidAmount * paid;
    else {
      const received = mintUsd.get(trade.mint);
      if (received !== undefined) valueUsd = trade.amount * received;
    }
  }

  return {
    ...trade,
    valueUsd,
    priceUsd: valueUsd === null ? null : valueUsd / trade.amount,
  };
}

/** How a mint in the history is shown. */
export interface TradeAssetLabel {
  symbol: string;
  imageUrl: string | null;
  /** In-app page, when Trador lists the asset. */
  href: string | null;
  kind: "stonk" | "stock" | "other";
}

export interface HistoryResponse {
  trades: WalletTrade[];
  positions: Position[];
  assets: Record<string, TradeAssetLabel>;
  /** False when the history store is not set up on this deployment. */
  available: boolean;
  /** Oldest `at` on this page, for the next request's `before`. Null at the end. */
  nextBefore: string | null;
  error?: string;
}

export interface Position {
  mint: string;
  /** Units bought and not since sold. */
  qty: number;
  /** What those units cost, at average cost. */
  costUsd: number;
  /** False when any trade in this coin was unpriced, or more was sold than bought. */
  complete: boolean;
}

/**
 * Average cost per coin, walking trades oldest first.
 *
 * A sell removes its share of the cost at the running average, so profit on
 * what is still held is not changed by what was taken earlier.
 */
export function positionsFrom(trades: readonly Pick<WalletTrade, "mint" | "side" | "amount" | "valueUsd" | "at">[]): Position[] {
  const book = new Map<string, Position>();
  const ordered = [...trades].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  for (const trade of ordered) {
    if (BASE_MINTS.has(trade.mint)) continue;
    const position = book.get(trade.mint) ?? {mint: trade.mint, qty: 0, costUsd: 0, complete: true};

    if (trade.side === "buy") {
      if (trade.valueUsd === null) position.complete = false;
      else position.costUsd += trade.valueUsd;
      position.qty += trade.amount;
    } else if (position.qty > 0) {
      const sold = Math.min(trade.amount, position.qty);
      position.costUsd -= position.costUsd * (sold / position.qty);
      position.qty -= sold;
      // Sold more than was bought: the rest arrived some other way.
      if (trade.amount > sold * (1 + 1e-9)) position.complete = false;
    } else {
      position.complete = false;
    }

    book.set(trade.mint, position);
  }
  return [...book.values()];
}

/** Units within this share of each other count as the same holding. */
const QTY_TOLERANCE = 0.02;

/**
 * Unrealised profit on a holding, in dollars.
 *
 * Current value of what is held minus what it cost. Units held beyond what the
 * history shows were bought (a transfer in, an airdrop) have no known cost, so
 * only the covered part is measured and the result is marked partial.
 */
function holdingPnl(
  held: number,
  valueUsd: number | null,
  position: Position | undefined,
): {usd: number; costUsd: number; partial: boolean} | null {
  if (!position || valueUsd === null || !(held > 0) || !(position.qty > 0)) return null;
  const covered = Math.min(held, position.qty);
  const coveredValue = valueUsd * (covered / held);
  const coveredCost = position.costUsd * (covered / position.qty);
  // No priced buys in the history for this slice — only transfers/airdrops.
  if (!(coveredCost > 0)) return null;
  const partial = !position.complete || held > position.qty * (1 + QTY_TOLERANCE);
  return {usd: coveredValue - coveredCost, costUsd: coveredCost, partial};
}

/** Look up cost basis by mint — keys are stored exactly as base58 spells them. */
export function positionByMint(
  positions: ReadonlyMap<string, Position>,
  mint: string,
): Position | undefined {
  const direct = positions.get(mint);
  if (direct) return direct;
  for (const [key, row] of positions) {
    if (key !== mint && samePubkey(key, mint)) return row;
  }
  return undefined;
}

export function holdingProfit(
  held: number,
  valueUsd: number | null,
  position: Position | undefined,
): {usd: number; partial: boolean} | null {
  const row = holdingPnl(held, valueUsd, position);
  return row ? {usd: row.usd, partial: row.partial} : null;
}

/** One row the portfolio total can sum — mint ties it to a cost-basis position. */
export interface HoldingForPnl {
  mint: string;
  amount: number;
  valueUsd: number | null;
}

/**
 * Unrealised P&L across every holding that has a known purchase price.
 *
 * Omits coins with no trade history or no price. When nothing qualifies, null.
 */
export function portfolioUnrealizedPnl(
  holdings: readonly HoldingForPnl[],
  positions: ReadonlyMap<string, Position>,
): {usd: number; pct: number | null; partial: boolean} | null {
  let usd = 0;
  let costUsd = 0;
  let partial = false;
  let any = false;

  for (const holding of holdings) {
    const row = holdingPnl(holding.amount, holding.valueUsd, positionByMint(positions, holding.mint));
    if (!row) continue;
    any = true;
    usd += row.usd;
    costUsd += row.costUsd;
    if (row.partial) partial = true;
  }

  if (!any) return null;
  return {usd, pct: costUsd > 0 ? (usd / costUsd) * 100 : null, partial};
}

/** "+$16.52" / "−$3.10" — the sign is part of the number. */
export function signedMoney(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  const body = abs.toLocaleString("en-US", {minimumFractionDigits: digits, maximumFractionDigits: digits});
  return `${value < 0 ? "−" : "+"}$${body}`;
}
