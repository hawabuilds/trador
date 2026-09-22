import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {snapshotStock} from "@/lib/server/snapshot";
import {fetchAssetPageData} from "@/lib/server/sources";

/** Rendered per request: it carries live prices and trades. */
export const dynamic = "force-dynamic";

export function generateMetadata({params}: {params: {ticker: string}}) {
  const stock = snapshotStock(decodeURIComponent(params.ticker));
  return {title: stock ? `${stock.ticker} — ${stock.name}` : "Stock"};
}

export default async function StockPage({
  params,
  searchParams,
}: {
  params: {ticker: string};
  searchParams: {tf?: string};
}) {
  // Tickers can carry a dot (BRK.Bx), so the param arrives encoded.
  const ticker = decodeURIComponent(params.ticker);
  if (!snapshotStock(ticker)) notFound();

  const requested = searchParams.tf ?? null;
  const initial = await fetchAssetPageData("stock", ticker, requested, null);

  return (
    <AssetPage kind="stock" id={ticker} requestedTimeframe={requested} initial={initial} />
  );
}
