import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {fetchAssetPageSecondary} from "@/lib/server/sources";
import type {Asset, AssetPageInitial} from "@/lib/types";

import {CoinSecondaryHydration} from "./CoinSecondaryHydration";

export async function CoinSecondaryStream({
  asset,
  requested,
  listedAt,
  at,
}: {
  asset: Asset;
  requested: string | null;
  listedAt: string | null;
  at: number;
}) {
  const timeframe = defaultChartTimeframe({
    kind: "stonk",
    listedAt,
    requested,
  });
  const secondary = await fetchAssetPageSecondary(asset, timeframe);
  const initial: AssetPageInitial = {
    at,
    asset: {asset, stale: false},
    chart: secondary.chart,
    trades: secondary.trades,
  };
  return <CoinSecondaryHydration initial={initial} />;
}
