import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {asPubkey} from "@/lib/pubkey";
import {snapshotStonk} from "@/lib/server/snapshot";

export function generateMetadata({params}: {params: {mint: string}}) {
  const stonk = snapshotStonk(params.mint);
  return {title: stonk ? `${stonk.symbol} / ${stonk.quoteTicker}` : "Coin"};
}

export default function StonkPage({
  params,
  searchParams,
}: {
  params: {mint: string};
  searchParams: {tf?: string};
}) {
  // Validate before looking anything up. A route param is user input, and a
  // mint that is not base58 is a 404 rather than a lookup that happens to miss.
  const mint = asPubkey(params.mint);
  if (!mint) notFound();
  if (!snapshotStonk(mint)) notFound();

  return <AssetPage kind="stonk" id={mint} requestedTimeframe={searchParams.tf ?? null} />;
}
