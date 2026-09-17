import {NextResponse} from "next/server";

import {cidFrom} from "@/lib/ipfsCid";

/**
 * Coin art from IPFS, fetched through whichever gateway is answering.
 *
 * Creator artwork lives wherever the creator put it, and for IPFS that means a
 * public gateway. The one most launchpads write into their metadata — `ipfs.io`
 * — answers **429** to this app's traffic, so those coins rendered with no
 * picture while the launchpad, which serves its own copies, showed them fine.
 *
 * Proxying alone does not fix that: the rate limit follows the request to the
 * server. What fixes it is that a CID is content-addressed, so *any* gateway
 * serves the same bytes — and measured against real CIDs from the store,
 * `ipfs.io`, `dweb.link` and `w3s.link` (one operator between them) all 429
 * while Pinata, Filebase and 4everland all return the image. So this tries them
 * in turn and returns the first that answers.
 *
 * The result is cached for a day at the edge, which is free: the bytes behind a
 * CID cannot change, so the only reason to fetch again is eviction.
 *
 * ## Not an open proxy
 *
 * A URL parameter that makes the server fetch it is a server-side request
 * forgery hole — `?u=http://169.254.169.254/…` would read cloud credentials.
 * So nothing here fetches the URL as given. The **CID is extracted** from it
 * and used to build a request to a gateway from the fixed list below, which
 * means a host this route was never pointed at cannot be reached at all, by
 * any input. On top of that:
 *
 *   - Only an image content type is passed through, so the route cannot be used
 *     to serve arbitrary content from this origin.
 *   - Redirects are not followed, so a gateway cannot forward the request
 *     somewhere else.
 *   - A size cap, so a hostile gateway cannot stream gigabytes through it.
 */

/**
 * Gateways to try, in order.
 *
 * Ordered by what actually answered when this was measured, not by reputation:
 * the canonical gateways are the ones rate-limiting us.
 */
const GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://4everland.io/ipfs/",
  // Last, because it is the one that throttles — but it is also the origin most
  // of these CIDs were published through, so it is worth a final try.
  "https://ipfs.io/ipfs/",
] as const;

/** Ten megabytes. Far above any icon, far below a denial of service. */
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u");
  if (!raw) return NextResponse.json({error: "Missing u."}, {status: 400});

  const cid = cidFrom(raw);
  if (!cid) {
    return NextResponse.json({error: "Not an IPFS URL."}, {status: 403});
  }

  let lastStatus = 0;

  for (const gateway of GATEWAYS) {
    try {
      const upstream = await fetch(`${gateway}${cid}`, {
        // A gateway must not be able to forward this request elsewhere.
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: {accept: "image/*"},
      });

      lastStatus = upstream.status;

      const type = upstream.headers.get("content-type") ?? "";
      if (!upstream.ok || !type.startsWith("image/")) continue;

      if (Number(upstream.headers.get("content-length") ?? 0) > MAX_BYTES) continue;

      const body = await upstream.arrayBuffer();
      if (body.byteLength > MAX_BYTES) continue;

      return new NextResponse(body, {
        headers: {
          "content-type": type,
          "cache-control":
            "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
        },
      });
    } catch {
      // Timeout or network failure. Try the next gateway.
    }
  }

  /*
   * Every gateway refused. A short cache even on failure, so one unreachable
   * CID does not mean a fresh four-gateway walk for every viewer — and short
   * enough that art which appears later is picked up within the minute.
   */
  return NextResponse.json(
    {error: `No gateway served this CID (last status ${lastStatus}).`},
    {status: 502, headers: {"cache-control": "public, max-age=60"}},
  );
}
