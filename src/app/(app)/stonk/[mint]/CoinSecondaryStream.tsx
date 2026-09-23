import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {fetchAssetPageSecondary} from "@/lib/server/sources";
import type {Asset, AssetPageInitial, CoinStatus} from "@/lib/types";

import {CoinSecondaryHydration} from "./CoinSecondaryHydration";

export async function CoinSecondaryStream({
  asset,
  requested,
  listedAt,
  coinStatus,
  at,
}: {
  asset: Asset;
  requested: string | null;
  listedAt: string | null;
  coinStatus: CoinStatus;
  at: number;
}) {
  const timeframe = defaultChartTimeframe({
    kind: "stonk",
    listedAt,
    coinStatus,
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
