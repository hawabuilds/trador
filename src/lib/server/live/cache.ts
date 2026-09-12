/**
 * An in-process TTL cache with stale-while-revalidate.
 *
 * Two jobs. The obvious one is not spending a provider call per request. The
 * one that matters more is that a provider failure must not blank a surface
 * that was working a second ago — so a fetch that throws falls through to the
 * last good value rather than propagating, and the caller is told the value is
 * stale instead of being handed nothing.
 */

interface Entry<T> {
  value: T;
  at: number;
  /** In-flight refresh, so N concurrent readers cause one provider call. */
  pending: Promise<T> | null;
}

const store = new Map<string, Entry<unknown>>();

export interface Cached<T> {
  value: T;
  /** True when the value is past its TTL and a refresh failed. */
  stale: boolean;
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<Cached<T>> {
  const now = Date.now();
  const entry = store.get(key) as Entry<T> | undefined;

  if (entry && now - entry.at < ttlMs) {
    return {value: entry.value, stale: false};
  }

  if (entry?.pending) {
    // A refresh is already in flight. Wait for it rather than starting a
    // second one — a popular asset would otherwise fan one page view out into
    // a dozen identical provider calls.
    try {
      return {value: await entry.pending, stale: false};
    } catch {
      return {value: entry.value, stale: true};
    }
  }

  const pending = load();
  if (entry) entry.pending = pending;

  try {
    const value = await pending;
    store.set(key, {value, at: Date.now(), pending: null});
    return {value, stale: false};
  } catch (error) {
    if (entry) {
      // Serve what we had. A chart that keeps showing a minute-old series is a
      // far better outcome than one that empties because a provider hiccuped.
      entry.pending = null;
      return {value: entry.value, stale: true};
    }
    throw error;
  }
}

/** Read without triggering a load. Used by routes that must not block. */
export function peek<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  return entry ? entry.value : null;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
