/**
 * Fetching a URL somebody typed into a comment.
 *
 * Anyone can post a link, and the server resolving it sits inside a private
 * network with credentials in its environment. So this is deliberately
 * unhelpful: only http and https, never an address that resolves inside the
 * network, redirects followed by hand and counted, a short timeout, and a cap
 * on how much is read. Each rule exists because the obvious implementation —
 * `fetch(url)` — hands a stranger a request from inside our perimeter.
 */

import {lookup} from "node:dns/promises";
import {isIP} from "node:net";

/** Redirects followed before giving up. Enough for a shortener, not a loop. */
const MAX_REDIRECTS = 3;

/** A page that has not answered by now is not worth a comment card. */
export const FETCH_TIMEOUT_MS = 4_000;

/** Read at most this much. Metadata lives in the first few kilobytes. */
export const MAX_BYTES = 512 * 1024;

export class UnsafeUrl extends Error {}

/**
 * Private, loopback, link-local and carrier ranges.
 *
 * The point is not to enumerate every reserved block but to refuse everything
 * that could reach something of ours: localhost, the cloud metadata address,
 * and anything inside a private network.
 */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address);

  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, and cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
    return false;
  }

  if (version === 6) {
    // An IPv6 address is hex and case-insensitive, unlike a Solana one.
    const value = address.toLowerCase(); // pubkey-lint-ok: an IP address, not a mint
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true; // unique local
    if (value.startsWith("fe80")) return true; // link-local
    // An IPv4 address wearing an IPv6 hat.
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true;
}

/** Throws unless this URL is safe to ask for. */
export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrl("That is not a URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrl("Only http and https are fetched.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrl("That address is internal.");
  }

  // Resolved, not just read: `http://127.0.0.1.nip.io` looks like a public
  // name and points at this machine.
  const addresses = isIP(host)
    ? [{address: host}]
    : await lookup(host, {all: true}).catch(() => {
        throw new UnsafeUrl("That host could not be resolved.");
      });

  if (addresses.length === 0) throw new UnsafeUrl("That host could not be resolved.");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrl("That address is internal.");
  }

  return parsed;
}

export interface SafeResponse {
  url: string;
  status: number;
  body: string;
  contentType: string | null;
}

/**
 * Fetch a stranger's URL, following redirects one at a time so each hop is
 * checked as strictly as the first. A redirect to `127.0.0.1` is the oldest
 * trick there is.
 */
export async function safeFetch(
  url: string,
  options: {
    accept?: string;
    headers?: Record<string, string>;
    maxBytes?: number;
    /** Stop reading once this appears — `</head>` for a page's metadata. */
    stopAfter?: string;
    timeoutMs?: number;
  } = {},
): Promise<SafeResponse> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS);

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertPublicUrl(current);

    const response = await fetch(parsed, {
      redirect: "manual",
      signal: deadline,
      headers: {
        ...options.headers,
        accept: options.accept ?? "text/html,application/json",
        // Named honestly. A card is being built for a person who posted the
        // link, and a site that would rather not be read can say no.
        "user-agent": "TradorLinkPreview/1.0 (+https://trador.one)",
      },
      cache: "no-store",
    });

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new UnsafeUrl("A redirect went nowhere.");
      current = new URL(next, parsed).toString();
      continue;
    }

    const body = await readCapped(response, maxBytes, options.stopAfter);
    return {
      url: current,
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
    };
  }

  throw new UnsafeUrl("Too many redirects.");
}

/**
 * Read the body up to the cap, or up to `stopAfter`, then stop pulling.
 *
 * The marker is what makes a big page affordable: the tags a card needs are in
 * `<head>`, and a news site's front page can be two megabytes of markup after
 * it. Reading to the cap on every link would be most of a second of transfer
 * for four attributes.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  stopAfter?: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  let size = 0;

  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (!value) continue;

      size += value.byteLength;
      text += decoder.decode(value, {stream: true});

      if (stopAfter && text.includes(stopAfter)) break;
      if (size >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text;
}
