import {badRequest, json, notFound, parseKind} from "@/lib/server/http";
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

  return json({asset: result.data, stale: result.stale});
}
