import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {snapshotStock} from "@/lib/server/snapshot";

export function generateMetadata({params}: {params: {ticker: string}}) {
  const stock = snapshotStock(decodeURIComponent(params.ticker));
  return {title: stock ? `${stock.ticker} — ${stock.name}` : "Stock"};
}

export default function StockPage({
  params,
  searchParams,
}: {
  params: {ticker: string};
  searchParams: {tf?: string};
}) {
  // Tickers can carry a dot (BRK.Bx), so the param arrives encoded.
  const ticker = decodeURIComponent(params.ticker);
  if (!snapshotStock(ticker)) notFound();

  return <AssetPage kind="stock" id={ticker} requestedTimeframe={searchParams.tf ?? null} />;
}
