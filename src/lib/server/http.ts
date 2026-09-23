import {NextResponse} from "next/server";

import {TIMEFRAMES, type Timeframe} from "@/lib/types";

/**
 * One place for route responses, so caching and error shapes cannot drift
 * between endpoints.
 */
export function json<T>(data: T, init?: {status?: number}) {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    // Private data and live prices: never let a CDN keep either.
    headers: {"cache-control": "no-store"},
  });
}

/** Public, cacheable at the edge, with stale-while-revalidate. */
export function publicJson<T>(data: T, seconds: number) {
  return NextResponse.json(data, {
    headers: {
      "cache-control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`,
    },
  });
}

/** Per-browser cache for wallet-scoped reads; never shared at the CDN. */
export function privateCachedJson<T>(data: T, seconds: number) {
  return NextResponse.json(data, {
    headers: {
      "cache-control": `private, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
    },
  });
}

export function badRequest(message: string) {
  return json({error: message}, {status: 400});
}

/**
 * 401, for a caller whose identity could not be established.
 *
 * Distinct from 403: this says "we do not know who you are", which the client
 * answers by signing in. A 403 would say "we know, and no", which would send
 * an expired session to a dead end.
 */
export function unauthorized(message = "Sign in to do that.") {
  return json({error: message}, {status: 401});
}

export function notFound(message = "Not found") {
  return json({error: message}, {status: 404});
}

/** `stonk` or `stock`, or null — never a silent default to one of them. */
export function parseKind(value: string): "stonk" | "stock" | null {
  return value === "stonk" || value === "stock" ? value : null;
}

export function parseTimeframe(value: string | null, fallback: Timeframe): Timeframe {
  return TIMEFRAMES.includes(value as Timeframe) ? (value as Timeframe) : fallback;
}
