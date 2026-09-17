/**
 * Reading a content id out of a URL.
 *
 * Its own module because a Next route file may only export route handlers, and
 * this needs to be importable by both the route and its test — it is the
 * security boundary in front of `/api/img`, which fetches a URL built from what
 * comes back. Anything it lets through that is not a content id is a
 * server-side request chosen by the caller.
 */

/**
 * The CID and path from a URL, or null.
 *
 * Accepts `ipfs://<cid>/<path>` and any `https://<host>/ipfs/<cid>/<path>`.
 * The host is deliberately ignored rather than checked: only the CID is kept,
 * and the request is rebuilt against a known gateway, so what the caller named
 * has no bearing on what gets fetched.
 */
export function cidFrom(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return null;

  const path = value.startsWith("ipfs://")
    ? value.slice("ipfs://".length)
    : (() => {
        try {
          const url = new URL(value);
          const marker = url.pathname.indexOf("/ipfs/");
          if (marker === -1) return null;
          return url.pathname.slice(marker + "/ipfs/".length);
        } catch {
          return null;
        }
      })();

  if (!path) return null;

  /*
   * A CID, then an optional path under it.
   *
   * Anchored and restricted to the characters a CID and a filename can hold, so
   * `..` traversal, a query string, or anything with a slash-dot-dot in it is
   * refused rather than cleaned — the gateway URL is built from this string.
   */
  if (!/^[A-Za-z0-9]{20,}(?:\/[A-Za-z0-9._-]+)*$/.test(path)) return null;
  if (path.includes("..")) return null;

  return path;
}
