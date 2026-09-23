import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {badRequest, json, parseKind, parseTimeframe} from "@/lib/server/http";
import {fetchAssetBundle, stonkFor} from "@/lib/server/sources";
import {asPubkey} from "@/lib/pubkey";
import {snapshotStock} from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";

/**
 * One round trip for asset + chart + trades. Used by prefetch and optional
 * client bundle hydration; live polls still hit the individual routes.
 */
export async function GET(
  request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return badRequest("Unknown asset kind.");

  const url = new URL(request.url);
  const stonk = kind === "stonk" ? await stonkFor(params.id) : null;
  const fallbackTf = defaultChartTimeframe({
    kind,
    listedAt: stonk?.listedAt ?? null,
    coinStatus: stonk?.status ?? null,
  });
  const timeframe = parseTimeframe(url.searchParams.get("tf"), fallbackTf);

  if (kind === "stonk" && !asPubkey(params.id)) {
    return badRequest("Not a valid mint.");
  }
  if (kind === "stock" && !snapshotStock(decodeURIComponent(params.id))) {
    return badRequest("Not listed here.");
  }

  const {asset, chart, trades} = await fetchAssetBundle(kind, params.id, timeframe);

  return json({
    asset: asset.data,
    assetStale: asset.stale,
    assetError: asset.error,
    chart: chart.data,
    chartStale: chart.stale,
    chartError: chart.error,
    trades: trades.data.trades,
    pollMs: trades.data.pollMs,
    source: trades.data.source,
    tapeComplete: trades.data.tapeComplete,
    tradesStale: trades.stale,
    tradesError: trades.error,
  });
}
