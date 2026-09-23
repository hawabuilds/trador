import {defaultChartTimeframe} from "@/lib/chartTimeframe";
import {badRequest, json, parseKind, parseTimeframe, publicJson} from "@/lib/server/http";
import {fetchChart, stonkFor} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

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
    requested: url.searchParams.get("tf"),
  });
  const timeframe = parseTimeframe(url.searchParams.get("tf"), fallbackTf);

  const result = await fetchChart(kind, params.id, timeframe);
  const body = {
    points: result.data.points,
    timeframe: result.data.timeframe,
    stale: result.stale,
    error: result.error,
  };
  // An answer is shared at the edge; a failure is not, so one provider hiccup
  // is not served to everyone for the next minute.
  return result.error ? json(body) : publicJson(body, 10);
}
