import {badRequest, json, parseKind, publicJson} from "@/lib/server/http";
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
    stale: result.stale,
    error: result.error,
  };
  // Two seconds at the edge, well inside the client's own poll, so a tape is
  // never older than one refresh but a busy coin is read once, not per viewer.
  return result.error ? json(body) : publicJson(body, 2);
}
