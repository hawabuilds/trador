/**
 * Real posts from the accounts behind tokenized stocks on Solana.
 *
 * These are the primary sources for this app's subject: the issuer that mints
 * the stock tokens, the launchpads the coins come from, and the venue that
 * routes the trades. When Backed says a new xStock is live, that post *is* the
 * news — it arrives hours before any wire writes it up.
 *
 * Nothing here is written on their behalf. These are real accounts belonging to
 * real organisations, so a card shows what was actually posted or it shows
 * nothing at all. An earlier design had a standing one-line description under
 * each name; attaching invented words to a real verified account is a
 * fabricated record, however harmless the words.
 *
 * The whole set is fetched in a single search — `from:a OR from:b` — rather than
 * one request per account. X's free tier counts requests, not results, and five
 * separate calls would exhaust the window five times as fast for the same data.
 */

import type {FeedItem} from "@/lib/types";
import {cached, peek} from "./cache";

const BASE = "https://api.x.com/2";

/**
 * Fifteen minutes.
 *
 * Matched to X's rate-limit window rather than to how fast these accounts post.
 * Overrunning it returns 429s for the rest of the window, which would cost the
 * tab its posts entirely.
 */
const TTL_MS = 15 * 60_000;

/**
 * The accounts the Solana side of the feed follows.
 *
 * Chosen for proximity to what this app indexes, not for follower count. Each
 * one is upstream of a row in the universe: Backed and xStocks mint the stocks
 * that coins are quoted in, StonkFun and pump.fun are the two launchpads the
 * indexer attributes against, and Jupiter is the router every trade goes
 * through.
 */
const HANDLES = [
  {handle: "xStocksFi", name: "xStocks"},
  {handle: "backed_fi", name: "Backed"},
  {handle: "stonkdotfun", name: "StonkFun"},
  {handle: "pumpdotfun", name: "pump.fun"},
  {handle: "JupiterExchange", name: "Jupiter"},
  {handle: "solana", name: "Solana"},
] as const;

interface SearchResponse {
  data?: {
    id: string;
    text: string;
    created_at?: string;
    author_id?: string;
  }[];
  includes?: {
    users?: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    }[];
  };
  errors?: unknown[];
}

/**
 * Strips the trailing t.co link X appends for a post's own media or quote.
 *
 * It is not part of what was written and renders as noise on a card that
 * already links to the post.
 */
function clean(text: string): string {
  return text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, "").trim();
}

async function load(): Promise<FeedItem[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];

  // Replies and retweets are excluded at the query rather than filtered after:
  // these accounts reply constantly, and a news tab of "@someone 🙏" is noise
  // that would also eat the results a single request returns.
  const from = HANDLES.map((entry) => `from:${entry.handle}`).join(" OR ");
  const params = new URLSearchParams({
    query: `(${from}) -is:reply -is:retweet`,
    max_results: "40",
    "tweet.fields": "created_at,author_id",
    expansions: "author_id",
    "user.fields": "profile_image_url",
  });

  const res = await fetch(`${BASE}/tweets/search/recent?${params}`, {
    headers: {authorization: `Bearer ${token}`},
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) throw new Error(`x search -> ${res.status}`);
  const body = (await res.json()) as SearchResponse;

  // The search returns author ids; the usernames come back in `includes`.
  const users = new Map(
    (body.includes?.users ?? []).map((user) => [user.id, user]),
  );

  const items: FeedItem[] = [];

  for (const post of body.data ?? []) {
    const user = post.author_id ? users.get(post.author_id) : undefined;
    /*
     * X handles are case-insensitive, so this fold is correct and is not the
     * base58 mistake the lint test guards against — `username` here is a
     * social handle, never an address. Named `username` rather than `id` for
     * exactly that reason.
     */
    const known = HANDLES.find(
      (entry) =>
        entry.handle.toLowerCase() === (user?.username ?? "").toLowerCase(),
    );
    // Only the accounts asked for. A search can widen unexpectedly, and a post
    // attributed to the wrong name is worse than no post at all.
    if (!known) continue;

    const text = clean(post.text);
    if (!text) continue;

    items.push({
      id: `x-${post.id}`,
      kind: "account",
      body: text,
      url: `https://x.com/${known.handle}/status/${post.id}`,
      source: known.name,
      handle: known.handle,
      publishedAt: post.created_at ?? new Date().toISOString(),
      tickers: [],
      topic: "posts",
      imageUrl: null,
      // X serves a 48px "_normal" crop by default, which is soft on a retina
      // avatar. The original is the same URL without that suffix.
      avatarUrl: user?.profile_image_url?.replace("_normal", "_400x400") ?? null,
      summary: null,
    });
  }

  return items.sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

/**
 * Recent posts, or nothing.
 *
 * Returning nothing is deliberate on failure: these cards sit under real names,
 * so an empty socials rail is the correct outcome when the real posts cannot be
 * reached. The same applies with no `X_BEARER_TOKEN` configured — the rail
 * simply does not render, and the rest of the tab is unaffected.
 */
export async function solanaPosts(): Promise<FeedItem[]> {
  const key = "x:posts";
  try {
    const loaded = await cached(key, TTL_MS, load);
    if (loaded.value.length > 0) return loaded.value;
  } catch (error) {
    console.error("x posts failed", error);
  }
  return peek<FeedItem[]>(key) ?? [];
}
