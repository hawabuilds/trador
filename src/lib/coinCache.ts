/**
 * The last few coin pages, kept on the device.
 *
 * Reopening a coin, or the app, then draws its header, chart and trades from
 * what was last seen while the fresh copy loads, instead of from nothing. It is
 * a convenience, never a source of truth: every restored entry is marked as
 * old, so the page asks for a fresh copy the moment it mounts.
 *
 * Browser storage can be missing, full or blocked, so every access is wrapped
 * and failure means only that nothing is restored.
 */

import type {QueryClient} from "@tanstack/react-query";

const STORAGE_KEY = "trador:coin-cache:v1";

/** The query families a coin page reads; see `useAsset`. */
const FAMILIES = new Set(["asset", "chart", "trades"]);

/**
 * Coins kept. A busy coin's chart alone is around 100KB, and it is kept whole:
 * trimmed, the saved chart would visibly rescale when the fresh one replaced
 * it. Twelve stays well inside the few megabytes a browser allows.
 */
const MAX_COINS = 12;

/** Older than this is more misleading than useful, so it is not restored. */
const MAX_AGE_MS = 60 * 60_000;

/** Trades kept per coin. The page shows the newest; the rest arrive fresh. */
const TRADES_KEPT = 60;

/** Writes are batched, since a busy page updates several queries a second. */
const WRITE_DELAY_MS = 2_000;

interface Entry {
  key: readonly unknown[];
  data: unknown;
  at: number;
}

const coinOf = (key: readonly unknown[]) => `${String(key[1])}:${String(key[2])}`;

function trimmed(key: readonly unknown[], data: unknown): unknown {
  if (key[0] !== "trades" || !data || typeof data !== "object") return data;
  const tape = data as {trades?: unknown[]};
  return Array.isArray(tape.trades) ? {...tape, trades: tape.trades.slice(0, TRADES_KEPT)} : data;
}

/** Put what was saved back into the query cache, marked as needing a refresh. */
export function restoreCoinCache(client: QueryClient): void {
  let entries: Entry[];
  try {
    entries = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as Entry[];
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;

  const now = Date.now();
  for (const entry of entries) {
    if (!Array.isArray(entry?.key) || !FAMILIES.has(String(entry.key[0]))) continue;
    if (!(now - entry.at < MAX_AGE_MS)) continue;
    if (client.getQueryData(entry.key)) continue;
    client.setQueryData(entry.key, entry.data, {updatedAt: entry.at});
  }
}

function write(client: QueryClient): void {
  const queries = client
    .getQueryCache()
    .findAll({
      predicate: (query) =>
        FAMILIES.has(String(query.queryKey[0])) &&
        query.state.status === "success" &&
        query.state.data != null,
    })
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt);

  const coins = new Set<string>();
  const entries: Entry[] = [];
  for (const query of queries) {
    const coin = coinOf(query.queryKey);
    if (!coins.has(coin)) {
      if (coins.size >= MAX_COINS) continue;
      coins.add(coin);
    }
    entries.push({
      key: query.queryKey,
      data: trimmed(query.queryKey, query.state.data),
      at: query.state.dataUpdatedAt,
    });
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked: the next launch simply starts empty.
  }
}

/** Save coin queries as they update. Returns the unsubscribe. */
export function persistCoinCache(client: QueryClient): () => void {
  let timer: number | null = null;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!FAMILIES.has(String(event.query.queryKey[0]))) return;
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
