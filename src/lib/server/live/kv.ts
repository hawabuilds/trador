/**
 * The Redis the project already has, over its REST API.
 *
 * Vercel gives every request a fresh instance sooner or later, so an
 * in-process cache there is a cache that mostly misses: the first reader of a
 * comment pays for the fetch, and so does the next one on a different machine.
 * This is the store that survives that — and it is shared, so one reader's
 * fetch answers everybody's.
 *
 * REST rather than a Redis client: a serverless function cannot hold a socket
 * open between invocations, and a connection pool per invocation is the
 * problem it was meant to solve. No dependency either, which is the other
 * reason — this is a cache, and a cache is not worth a package.
 *
 * Nothing here ever throws. A cache that can fail a request is worse than no
 * cache, so every call answers null or false and the caller carries on.
 */

/*
 * The cache store's own variables first.
 *
 * The project still carries `KV_*` from an earlier store that no longer
 * exists — its host does not resolve — and those are scoped to Production as
 * well, so they cannot be replaced without touching production. The store this
 * cache uses is a separate one, connected to Preview and Development under the
 * `CACHE_` prefix, and the bare names stay as the fallback for whenever they
 * point at something real again.
 */
const URL_ENV = (process.env.CACHE_KV_REST_API_URL || process.env.KV_REST_API_URL || "")
  .replace(/\/$/, "");
const TOKEN_ENV = process.env.CACHE_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || "";

/** Whether this deployment is configured for one. Local and the worker are not. */
export const kvReady: boolean = Boolean(URL_ENV && TOKEN_ENV);

/** Whether it is worth asking right now — false while a failure is standing. */
export const kvUsable = (): boolean => kvReady && Date.now() >= pausedUntil;

/** Long enough to be worth asking, short enough never to delay a card. */
const TIMEOUT_MS = 2_000;

/**
 * How long to stop asking after a failure.
 *
 * The project can carry the environment variables of a store that is no longer
 * there — these ones currently resolve to nothing — and without this every
 * card would pay for a doomed request twice over. One failure stands the store
 * down for a minute; the caller falls back to its own cache meanwhile.
 */
const PAUSE_MS = 60_000;

let pausedUntil = 0;

async function command(parts: (string | number)[]): Promise<unknown> {
  if (!kvReady || Date.now() < pausedUntil) return null;

  const response = await fetch(URL_ENV, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN_ENV}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(parts),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`KV returned ${response.status}.`);
  pausedUntil = 0;

  const body = (await response.json()) as {result?: unknown; error?: string};
  if (body.error) throw new Error(body.error);
  return body.result ?? null;
}

/** A stored value, or null when it is missing, expired or unreadable. */
export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const result = await command(["GET", key]);
    return typeof result === "string" ? (JSON.parse(result) as T) : null;
  } catch {
    pausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}

/** Store a value for `ttlSeconds`. Says whether it landed; never throws. */
export async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  try {
    await command(["SET", key, JSON.stringify(value), "EX", Math.max(1, Math.round(ttlSeconds))]);
    return true;
  } catch {
    pausedUntil = Date.now() + PAUSE_MS;
    return false;
  }
}
