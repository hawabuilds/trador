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
  const body = {
    trades: result.data.trades,
    pollMs: result.data.pollMs,
    source: result.data.source,
    tapeComplete: result.data.tapeComplete,
    stale: result.stale,
    error: result.error,
  };
  // Live tape: extend chain fills in-process (warm polls are cheap). coin_tapes
  // is fallback when chain cannot answer, not the primary source on polls.
  return json(body);
}
