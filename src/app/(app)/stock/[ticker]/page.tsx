import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {snapshotStock} from "@/lib/server/snapshot";

export function generateMetadata({params}: {params: {ticker: string}}) {
  const stock = snapshotStock(decodeURIComponent(params.ticker));
  return {title: stock ? `${stock.ticker} — ${stock.name}` : "Stock"};
}

export default function StockPage({params}: {params: {ticker: string}}) {
  // Tickers can carry a dot (BRK.Bx), so the param arrives encoded.
  const stock = snapshotStock(decodeURIComponent(params.ticker));
  if (!stock) notFound();

  return <AssetPage asset={stock} />;
}
