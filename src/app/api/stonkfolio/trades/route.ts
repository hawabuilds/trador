import {USDC_MINT, WSOL_MINT} from "@/lib/programs";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {badRequest, json} from "@/lib/server/http";
import {universeFor} from "@/lib/server/live/holdings";
import {jupTokens} from "@/lib/server/live/jupTokens";
import {
  HistoryUnavailable,
  syncWalletTrades,
  walletHistory,
  walletPositions,
} from "@/lib/server/live/walletTrades";
import type {HistoryResponse, TradeAssetLabel} from "@/lib/walletTrades";

export const dynamic = "force-dynamic";

const PAGE = 50;

const KNOWN: Record<string, TradeAssetLabel> = {
  [WSOL_MINT]: {symbol: "SOL", imageUrl: null, href: null, kind: "other"},
  [USDC_MINT]: {symbol: "USDC", imageUrl: null, href: null, kind: "other"},
};

async function labelsFor(mints: string[]): Promise<Record<string, TradeAssetLabel>> {
  const labels: Record<string, TradeAssetLabel> = {};
  const wanted = mints.filter((mint) => !KNOWN[mint]);
  for (const mint of mints) if (KNOWN[mint]) labels[mint] = KNOWN[mint];
  if (wanted.length === 0) return labels;

  const universe = await universeFor(wanted).catch(() => new Map());
  const outside: Pubkey[] = [];
  for (const mint of wanted) {
    const asset = universe.get(mint);
    if (!asset) {
      const pubkey = asPubkey(mint);
      if (pubkey) outside.push(pubkey);
      continue;
    }
    labels[mint] =
      asset.kind === "stock"
        ? {symbol: asset.ticker, imageUrl: null, href: `/stock/${asset.ticker}`, kind: "stock"}
        : {symbol: asset.symbol, imageUrl: asset.imageUrl, href: `/stonk/${asset.mint}`, kind: "stonk"};
  }

  // Coins Trador does not list still get a name and picture where Jupiter has one.
  if (outside.length > 0) {
    const tokens = await jupTokens(outside).catch(() => new Map());
    for (const mint of outside) {
      const token = tokens.get(mint);
      labels[mint] = {
        symbol: token?.symbol ?? `${mint.slice(0, 4)}…`,
        imageUrl: token?.icon ?? null,
        href: null,
        kind: "other",
      };
    }
  }
  return labels;
}

/**
 * A wallet's trades, newest first, with its cost basis per coin.
 *
 * Syncs from chain first, so a trade made a moment ago is in the answer. A
 * deployment without the history tables answers `available: false` instead of
 * failing, so the Stonkfolio still loads.
 *
 * (`/api/stonkfolio/history` is the balance chart's series; this is trades.)
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const wallet = asPubkey(params.get("wallet"));
  if (!wallet) return badRequest("A base58 wallet address is required.");

  const mintParam = params.get("mint");
  const mint = mintParam ? asPubkey(mintParam) : null;
  if (mintParam && !mint) return badRequest("The mint must be base58.");

  const before = params.get("before");
  if (before && Number.isNaN(Date.parse(before))) {
    return badRequest("`before` must be a timestamp.");
  }

  const empty: HistoryResponse = {
    trades: [],
    positions: [],
    assets: {},
    available: false,
    nextBefore: null,
  };

  try {
    await syncWalletTrades(wallet);
    const [trades, positions] = await Promise.all([
      walletHistory(wallet, {mint, before, limit: PAGE}),
      // Cost basis is only needed on the first page of the all-coins view.
      before || mint ? Promise.resolve([]) : walletPositions(wallet),
    ]);
    const assets = await labelsFor([...new Set(trades.flatMap((t) => [t.mint, t.paidMint]))]);

    const body: HistoryResponse = {
      trades,
      positions,
      assets,
      available: true,
      nextBefore: trades.length === PAGE ? trades[trades.length - 1].at : null,
    };
    return json(body);
  } catch (error) {
    if (error instanceof HistoryUnavailable) {
      return json({...empty, error: error.message});
    }
    return json({...empty, available: true, error: (error as Error).message}, {status: 502});
  }
}
