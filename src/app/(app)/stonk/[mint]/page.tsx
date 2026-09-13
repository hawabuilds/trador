import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {asPubkey} from "@/lib/pubkey";
import {stonkFor} from "@/lib/server/sources";

/**
 * Rendered per request, because membership is a live question.
 *
 * Both of these used to answer it from `snapshotStonk` — the coins baked into
 * the bundle at build time. That was correct only while the feed read the same
 * snapshot. Once the feed was switched to the live store, the feed offered 336
 * coins and this page recognised 140, so **196 of them rendered a row you could
 * tap and Next's 404 when you did** — and the gap widened with every sweep the
 * indexer ran.
 *
 * `stonkFor` reads the store first and falls back to the snapshot, which is the
 * same order every other surface uses. It is `cache`d, so the two calls here
 * cost one lookup.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({params}: {params: {mint: string}}) {
  const stonk = await stonkFor(params.mint);
  return {title: stonk ? `${stonk.symbol} / ${stonk.quoteTicker}` : "Coin"};
}

export default async function StonkPage({
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

  /*
   * A 404 here means "no such coin anywhere", not "the store was slow".
   *
   * `stonkFor` already swallows store errors and falls through to the
   * snapshot, so reaching this line means both sources came back empty.
   */
  if (!(await stonkFor(mint))) notFound();

  return <AssetPage kind="stonk" id={mint} requestedTimeframe={searchParams.tf ?? null} />;
}
