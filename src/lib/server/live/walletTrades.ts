/**
 * Sync a wallet's trades from chain into the store, and read them back.
 *
 * Parsed transactions are the expensive tier, so they are parsed once:
 *
 *   1. List signatures since the stored cursor — a plain RPC call.
 *   2. Parse only those, a hundred at a time.
 *   3. Store the trades found, and move the cursor to the newest signature.
 *
 * A wallet that has not traded since the last visit costs one cheap call.
 * The first visit reads at most `FIRST_SYNC_MAX` signatures, so a very old,
 * very busy wallet's earliest trades are not counted — said in the UI rather
 * than implied.
 */

import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {isStockMint} from "@/lib/stocks/registry";
import {db, hasDatabase} from "@/lib/server/db";
import {
  SOL_MINT,
  positionsFrom,
  tradesFromTx,
  valueTrade,
  type Position,
  type RawTrade,
  type WalletTrade,
} from "@/lib/walletTrades";
import {cached} from "./cache";
import {solUsdAt} from "./gecko";
import {PARSE_BATCH, heliusKey, parseTransactions, signaturesFor} from "./helius";

const SIGNATURE_PAGE = 1000;
export const FIRST_SYNC_MAX = 2000;
/** Parse calls in flight at once. */
const PARSE_CONCURRENCY = 3;
/** One sync per wallet per this window, however many screens ask. */
const SYNC_TTL_MS = 15_000;

interface Row {
  wallet: string;
  signature: string;
  mint: string;
  side: "buy" | "sell";
  amount: number | string;
  paid_mint: string;
  paid_amount: number | string;
  value_usd: number | string | null;
  price_usd: number | string | null;
  at: string;
}

const numOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

function toTrade(row: Row): WalletTrade {
  return {
    signature: row.signature,
    at: new Date(row.at).toISOString(),
    mint: row.mint,
    side: row.side,
    amount: Number(row.amount),
    paidMint: row.paid_mint,
    paidAmount: Number(row.paid_amount),
    valueUsd: numOrNull(row.value_usd),
    priceUsd: numOrNull(row.price_usd),
  };
}

/** A missing table means the migration has not run: history is simply empty. */
function isMissingTable(error: {code?: string; message?: string} | null): boolean {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|could not find the table/i.test(error?.message ?? "")
  );
}

export class HistoryUnavailable extends Error {}

async function signaturesSince(wallet: Pubkey, head: string | null) {
  const rows: {signature: string; err: unknown}[] = [];
  let before: string | undefined;
  while (rows.length < FIRST_SYNC_MAX) {
    const page = await signaturesFor(wallet, {
      limit: SIGNATURE_PAGE,
      ...(head ? {until: head} : {}),
      ...(before ? {before} : {}),
    });
    rows.push(...page);
    if (page.length < SIGNATURE_PAGE) break;
    before = page[page.length - 1].signature;
  }
  return rows.slice(0, FIRST_SYNC_MAX);
}

async function parseAll(signatures: string[], key: string) {
  const batches: string[][] = [];
  for (let i = 0; i < signatures.length; i += PARSE_BATCH) {
    batches.push(signatures.slice(i, i + PARSE_BATCH));
  }
  const parsed = [];
  for (let i = 0; i < batches.length; i += PARSE_CONCURRENCY) {
    const results = await Promise.all(
      batches.slice(i, i + PARSE_CONCURRENCY).map((batch) => parseTransactions(batch, key)),
    );
    parsed.push(...results.flat());
  }
  return parsed;
}

async function stockUsdMap(trades: readonly RawTrade[]): Promise<Map<string, number>> {
  const mints: Pubkey[] = [];
  for (const trade of trades) {
    const paid = asPubkey(trade.paidMint);
    const asset = asPubkey(trade.mint);
    if (paid && isStockMint(paid)) mints.push(paid);
    if (asset && isStockMint(asset)) mints.push(asset);
  }
  if (mints.length === 0) return new Map();
  const {stockPrices} = await import("./stockPrices");
  const quotes = await stockPrices(mints);
  const out = new Map<string, number>();
  for (const [mint, quote] of quotes) {
    if (quote.usd !== null) out.set(mint, quote.usd);
  }
  return out;
}

async function priced(raw: RawTrade[]): Promise<WalletTrade[]> {
  const mintUsd = await stockUsdMap(raw);
  const out: WalletTrade[] = [];
  for (const trade of raw) {
    const needsSol = trade.paidMint === SOL_MINT || trade.mint === SOL_MINT;
    const solUsd = needsSol
      ? await solUsdAt(Date.parse(trade.at) / 1000).catch(() => null)
      : null;
    out.push(valueTrade(trade, solUsd, mintUsd));
  }
  return out;
}

type PositionTradeRow = Pick<
  Row,
  "mint" | "side" | "amount" | "value_usd" | "paid_mint" | "paid_amount" | "at"
>;

/** Stored trades with null `value_usd` get repriced here (stock-paid buys, etc.). */
async function tradesForPositions(rows: PositionTradeRow[]) {
  if (rows.length === 0) return [];
  const nullRows = rows.filter((row) => row.value_usd === null);
  const mintUsd = await stockUsdMap(
    nullRows.map((row) => ({
      signature: "",
      at: new Date(row.at).toISOString(),
      mint: row.mint,
      side: row.side,
      amount: Number(row.amount),
      paidMint: row.paid_mint,
      paidAmount: Number(row.paid_amount),
    })),
  );
  const solUsdCache = new Map<string, number | null>();
  const out: Pick<WalletTrade, "mint" | "side" | "amount" | "valueUsd" | "at">[] = [];

  for (const row of rows) {
    const at = new Date(row.at).toISOString();
    const stored = numOrNull(row.value_usd);
    if (stored !== null) {
      out.push({
        mint: row.mint,
        side: row.side,
        amount: Number(row.amount),
        valueUsd: stored,
        at,
      });
      continue;
    }
    const raw: RawTrade = {
      signature: "",
      at,
      mint: row.mint,
      side: row.side,
      amount: Number(row.amount),
      paidMint: row.paid_mint,
      paidAmount: Number(row.paid_amount),
    };
    const needsSol = raw.paidMint === SOL_MINT || raw.mint === SOL_MINT;
    let solUsd: number | null = null;
    if (needsSol) {
      if (!solUsdCache.has(at)) {
        solUsdCache.set(
          at,
          await solUsdAt(Date.parse(at) / 1000).catch(() => null),
        );
      }
      solUsd = solUsdCache.get(at) ?? null;
    }
    const valued = valueTrade(raw, solUsd, mintUsd);
    out.push({
      mint: raw.mint,
      side: raw.side,
      amount: raw.amount,
      valueUsd: valued.valueUsd,
      at,
    });
  }
  return out;
}

async function syncOnce(wallet: Pubkey): Promise<void> {
  const key = heliusKey();
  if (!key) throw new HistoryUnavailable("No Helius key is configured.");

  const cursor = await db()
    .from("wallet_trade_cursors")
    .select("head_signature")
    .eq("wallet", wallet)
    .maybeSingle();
  if (cursor.error) {
    if (isMissingTable(cursor.error)) throw new HistoryUnavailable("Trade history is not set up yet.");
    throw new Error(cursor.error.message);
  }
  const head = (cursor.data?.head_signature as string | null | undefined) ?? null;

  const rows = await signaturesSince(wallet, head);
  if (rows.length === 0 && head) return;

  const parsed = await parseAll(
    rows.filter((row) => !row.err).map((row) => row.signature),
    key,
  );
  const trades = await priced(parsed.flatMap((tx) => tradesFromTx(tx, wallet)));

  if (trades.length > 0) {
    const {error} = await db()
      .from("wallet_trades")
      .upsert(
        trades.map((trade) => ({
          wallet,
          signature: trade.signature,
          mint: trade.mint,
          side: trade.side,
          amount: trade.amount,
          paid_mint: trade.paidMint,
          paid_amount: trade.paidAmount,
          value_usd: trade.valueUsd,
          price_usd: trade.priceUsd,
          at: trade.at,
        })),
        {onConflict: "wallet,signature,mint"},
      );
    if (error) throw new Error(`Saving trades failed: ${error.message}`);
  }

  // Only after the trades are safely stored, so a failure re-reads them.
  const newest = rows[0]?.signature ?? head;
  const {error} = await db()
    .from("wallet_trade_cursors")
    .upsert({wallet, head_signature: newest, synced_at: new Date().toISOString()});
  if (error) throw new Error(`Saving the history cursor failed: ${error.message}`);
}

/** Bring a wallet's stored trades up to date. Shared by concurrent callers. */
export async function syncWalletTrades(wallet: Pubkey): Promise<void> {
  if (!hasDatabase) throw new HistoryUnavailable("Trade history needs the database.");
  await cached(`wallet-sync:${wallet}`, SYNC_TTL_MS, async () => {
    await syncOnce(wallet);
    return true;
  });
}

export async function walletHistory(
  wallet: Pubkey,
  options: {mint?: Pubkey | null; before?: string | null; limit?: number} = {},
): Promise<WalletTrade[]> {
  let query = db()
    .from("wallet_trades")
    .select("*")
    .eq("wallet", wallet)
    .order("at", {ascending: false})
    .order("signature", {ascending: false})
    .limit(options.limit ?? 50);
  if (options.mint) query = query.eq("mint", options.mint);
  if (options.before) query = query.lt("at", options.before);

  const {data, error} = await query;
  if (error) {
    if (isMissingTable(error)) throw new HistoryUnavailable("Trade history is not set up yet.");
    throw new Error(error.message);
  }
  return ((data ?? []) as Row[]).map(toTrade);
}

/** Cost basis per coin, from every stored trade. */
export async function walletPositions(wallet: Pubkey): Promise<Position[]> {
  const {data, error} = await db()
    .from("wallet_trades")
    .select("mint, side, amount, value_usd, paid_mint, paid_amount, at")
    .eq("wallet", wallet)
    .order("at", {ascending: true})
    .limit(10_000);
  if (error) {
    if (isMissingTable(error)) throw new HistoryUnavailable("Trade history is not set up yet.");
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PositionTradeRow[];
  return positionsFrom(await tradesForPositions(rows));
}
