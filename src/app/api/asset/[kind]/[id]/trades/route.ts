import {badRequest, json, parseKind} from "@/lib/server/http";
import {fetchTrades} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return badRequest("Unknown asset kind.");

  const result = await fetchTrades(kind, params.id);
  return json({
    trades: result.data.trades,
    pollMs: result.data.pollMs,
    source: result.data.source,
    stale: result.stale,
    error: result.error,
  });
}
