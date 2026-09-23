/**
 * Short-lived feed query persistence — same idea as `coinCache`, scoped to the
 * home feed so tab switches do not replay a cold fetch from nothing.
 */

import type {QueryClient} from "@tanstack/react-query";

const STORAGE_KEY = "trador:feed-cache:v1";
const FAMILY = "feed";

/** Trending / all quotes only — keyed surfaces are not restored. */
const MAX_AGE_MS = 2 * 60_000;

const WRITE_DELAY_MS = 3_000;

interface Entry {
  key: readonly unknown[];
  data: unknown;
  at: number;
}

function restorable(key: readonly unknown[]): boolean {
  if (String(key[0]) !== FAMILY) return false;
  if (key.length !== 5) return false;
  const sort = String(key[1]);
  const quote = String(key[2]);
  const stocks = key[3];
  const graduating = key[4];
  return sort === "trending" && quote === "all" && stocks === false && graduating === false;
}

export function restoreFeedCache(client: QueryClient): void {
  let entries: Entry[];
  try {
    entries = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Entry[];
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;

  const now = Date.now();
  for (const entry of entries) {
    if (!Array.isArray(entry?.key) || !restorable(entry.key)) continue;
    if (!(now - entry.at < MAX_AGE_MS)) continue;
    if (client.getQueryData(entry.key)) continue;
    client.setQueryData(entry.key, entry.data, {updatedAt: entry.at});
  }
}

function write(client: QueryClient): void {
  const query = client
    .getQueryCache()
    .findAll({
      predicate: (q) =>
        restorable(q.queryKey) &&
        q.state.status === "success" &&
        q.state.data != null,
    })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];

  if (!query) return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        {
          key: query.queryKey,
          data: query.state.data,
          at: query.state.dataUpdatedAt,
        },
      ]),
    );
  } catch {
    // Full or blocked — skip.
  }
}

export function persistFeedCache(client: QueryClient): () => void {
  let timer: number | null = null;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!restorable(event.query.queryKey)) return;
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      write(client);
    }, WRITE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== null) window.clearTimeout(timer);
  };
}
