import {Suspense} from "react";
import {notFound} from "next/navigation";

import {AssetPage} from "@/components/AssetPage";
import {asPubkey} from "@/lib/pubkey";
import {fetchAssetPageHeader, stonkFor} from "@/lib/server/sources";

import {CoinPageView} from "./CoinPageView";
import {CoinSecondaryStream} from "./CoinSecondaryStream";

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
   * `stonkFor` reads the store, then the snapshot, then — for a mint neither
   * knows — the chain, and registers a launch it can verify. Reaching this
   * line means all three came back empty.
   */
  const stonk = await stonkFor(mint);
  if (!stonk) notFound();

  const requested = searchParams.tf ?? null;
  const at = Date.now();
  const header = await fetchAssetPageHeader("stonk", mint);
  if (!header) notFound();

  return (
    <>
      <CoinPageView mint={mint} />
      <AssetPage
        kind="stonk"
        id={mint}
        requestedTimeframe={requested}
        initial={{at, asset: header, chart: null, trades: null}}
      />
      <Suspense fallback={null}>
        <CoinSecondaryStream
          asset={header.asset}
          requested={requested}
          listedAt={stonk.listedAt}
          coinStatus={stonk.status}
          at={at}
        />
      </Suspense>
    </>
  );
}
