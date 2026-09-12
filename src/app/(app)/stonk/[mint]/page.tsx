import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {snapshotStonk} from "@/lib/server/snapshot";
import {asPubkey} from "@/lib/pubkey";

export function generateMetadata({params}: {params: {mint: string}}) {
  const stonk = snapshotStonk(params.mint);
  return {title: stonk ? `${stonk.symbol} / ${stonk.quoteTicker}` : "Coin"};
}

export default function StonkPage({params}: {params: {mint: string}}) {
  // Validate before looking up. A route param is user input, and a mint that is
  // not base58 is a 404 rather than a lookup that happens to miss.
  const mint = asPubkey(params.mint);
  if (!mint) notFound();

  const stonk = snapshotStonk(mint);
  if (!stonk) notFound();

  return <AssetPage asset={stonk} />;
}
