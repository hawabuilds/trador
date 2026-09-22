import {badRequest, notFound, parseKind, publicJson} from "@/lib/server/http";
import {fetchAsset} from "@/lib/server/sources";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {params}: {params: {kind: string; id: string}},
) {
  const kind = parseKind(params.kind);
  if (!kind) return badRequest("Unknown asset kind.");

  const result = await fetchAsset(kind, params.id);
  if (!result.data) return notFound(result.error ?? "Not listed here.");

  // Shared at the edge for a few seconds: every viewer of a coin wants the same
  // answer, and one server's warm cache should serve them all.
  return publicJson({asset: result.data, stale: result.stale}, 5);
}
