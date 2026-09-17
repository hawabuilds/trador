/**
 * Which artwork URL the browser should actually load.
 *
 * Stored URLs are left exactly as the creator published them — that is the
 * record of where the art lives, and rewriting it in the database would lose
 * the original. This is applied on the way out instead, so it also fixes every
 * row already stored without a migration.
 *
 * Only the gateways that throttle get proxied. `ipfs.io` and its siblings answer
 * 429 to this app's traffic, which is why 66 coins showed no picture while the
 * launchpad showed theirs. `/api/img` re-fetches the same CID from a gateway
 * that is answering and caches it at the edge. Everything else — Irys, the
 * launchpad CDNs, the overwhelming majority — loads directly, because proxying
 * something that already works only adds a hop.
 */

/**
 * The gateways measured as rate-limiting this app, and nothing else.
 *
 * All three are one operator, and all three answered 429 for every CID tested
 * from the store. A host that serves its art fine — Irys, a launchpad CDN, a
 * project's own pinning service — is left alone: sending it through a public
 * gateway would add a hop and risk a CID that only that service has pinned.
 */
const PROXY_HOSTS = new Set(["ipfs.io", "dweb.link", "w3s.link"]);

/** A bare `ipfs://CID` needs a gateway before it is a URL at all. */
const IPFS_SCHEME = "ipfs://";

export function displayImageUrl(url: string | null): string | null {
  if (!url) return null;

  if (url.startsWith(IPFS_SCHEME)) {
    const path = url.slice(IPFS_SCHEME.length);
    return `/api/img?u=${encodeURIComponent(`https://ipfs.io/ipfs/${path}`)}`;
  }

  let host: string;
  try {
    const parsed = new URL(url);
    // Only https is proxied; the route refuses anything else anyway, and an
    // http image would be blocked as mixed content before it got there.
    if (parsed.protocol !== "https:") return url;
    host = parsed.hostname.toLowerCase();
  } catch {
    // Not a URL we can reason about. Passed through rather than dropped: the
    // <img> will fail and fall back to the generated avatar, which is the same
    // outcome as returning null but keeps this function non-destructive.
    return url;
  }

  return PROXY_HOSTS.has(host) ? `/api/img?u=${encodeURIComponent(url)}` : url;
}
