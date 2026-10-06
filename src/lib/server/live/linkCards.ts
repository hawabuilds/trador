/**
 * Turning a link somebody posted into a card.
 *
 * Every resolver here can fail, and failing is ordinary: a tweet gets deleted,
 * a news site blocks robots, a signature is too old for the parse tier. So each
 * one returns a plain card rather than throwing, and the comment keeps its
 * link. The only thing that is never guessed is `proof` — see `linkPreview.ts`.
 *
 * Resolved cards are cached by URL in the process cache. The same link posted
 * under a busy coin would otherwise resolve once per reader.
 */

import type {Asset} from "@/lib/types";
import {asPubkey} from "@/lib/pubkey";
import {compact, compactMoney, relativeTime, shortAddress, units} from "@/lib/format";
import {
  type CommentLink,
  type LinkCard,
  type NewsCard,
  type TxCard,
  type WalletCard,
  type XCard,
  domainOf,
  plainCard,
  txIsProof,
  walletIsProof,
} from "@/lib/linkPreview";
import {BASE_MINTS, SOL_MINT, type RawTrade, tradesFromTx, valueTrade} from "@/lib/walletTrades";
import {USDC_MINT} from "@/lib/programs";
import {cached} from "./cache";
import {kvGet, kvSet, kvUsable} from "./kv";
import {cleanTweet, decodeEntities, meta, textFromHtml} from "./linkParse";
import {rawTransactions} from "./rawTransactions";
import {safeFetch} from "./safeFetch";

/**
 * An hour.
 *
 * A post's text does not change, and a card that resolved an hour ago is still
 * true. A card that *failed* is cached for the same hour on purpose: a site
 * that blocks us blocks us in ten minutes too, and retrying per reader would
 * spend a fetch on every scroll past the same dead link.
 */
const TTL_SECONDS = 60 * 60;

/**
 * A page is read this far looking for `</head>`, and no further.
 *
 * Generous on purpose. A site built with a modern framework can ship half a
 * megabyte of inlined styles before its own metadata — CoinDesk's `og:title`
 * sits at 529KB — and a smaller cap silently turns those into plain cards.
 */
const NEWS_MAX_BYTES = 1024 * 1024;

/** Cards per comment body. Past this it is a link dump, not evidence. */
export const MAX_CARDS = 3;

/** What a trade was paid in, for the handful of mints that have no row. */
const BASE_SYMBOL = new Map<string, string>([
  [SOL_MINT, "SOL"],
  [USDC_MINT, "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
]);

/* ---------------------------------------------------------------- X ------ */

interface ApiTweet {
  data?: {id: string; text: string; created_at?: string; author_id?: string};
  includes?: {users?: {id: string; name: string; username: string}[]};
}

/** One post, read with the app's own bearer token. */
async function tweetFromApi(id: string): Promise<XCard | null> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return null;

  const url =
    `https://api.x.com/2/tweets/${id}` +
    "?tweet.fields=created_at&expansions=author_id&user.fields=name,username";

  const response = await safeFetch(url, {
    accept: "application/json",
    headers: {authorization: `Bearer ${token}`},
  });
  if (response.status !== 200) return null;

  const body = JSON.parse(response.body) as ApiTweet;
  const post = body.data;
  if (!post?.text) return null;

  const user = body.includes?.users?.find((entry) => entry.id === post.author_id);

  return {
    kind: "x",
    url: `https://x.com/${user?.username ?? "i"}/status/${post.id}`,
    domain: "x.com",
    proof: true,
    author: user?.name ?? "On X",
    handle: user?.username ?? "",
    text: cleanTweet(post.text),
    postedAt: post.created_at ?? null,
  };
}

/**
 * The same post without a token, through the public embed endpoint.
 *
 * It answers for public posts only, which is the behaviour wanted anyway: a
 * protected account's post is not something to reproduce on a card.
 */
async function tweetFromEmbed(url: string): Promise<XCard | null> {
  const endpoint =
    "https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=" +
    encodeURIComponent(url);

  const response = await safeFetch(endpoint, {accept: "application/json"});
  if (response.status !== 200) return null;

  const body = JSON.parse(response.body) as {
    html?: string;
    author_name?: string;
    author_url?: string;
  };
  const text = cleanTweet(textFromHtml(body.html ?? ""));
  if (!text) return null;

  return {
    kind: "x",
    url,
    domain: "x.com",
    proof: true,
    author: body.author_name ?? "On X",
    handle: body.author_url?.split("/").filter(Boolean).pop() ?? "",
    text,
    postedAt: null,
  };
}

/* ------------------------------------------------------------- news ------ */

/** A page's own description of itself. */
async function newsCard(url: string): Promise<NewsCard | null> {
  const response = await safeFetch(url, {
    accept: "text/html,application/xhtml+xml",
    maxBytes: NEWS_MAX_BYTES,
    stopAfter: "</head>",
    timeoutMs: 6_000,
  });
  if (response.status !== 200) return null;
  if (!(response.contentType ?? "").includes("html")) return null;

  const html = response.body;
  const title =
    meta(html, "og:title") ??
    meta(html, "twitter:title") ??
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  if (!title) return null;

  const image = meta(html, "og:image") ?? meta(html, "twitter:image");
  let imageUrl: string | null = null;
  if (image) {
    try {
      const absolute = new URL(image, response.url);
      // An http image is blocked on an https page, so it is no image at all.
      if (absolute.protocol === "https:") imageUrl = absolute.toString();
    } catch {
      imageUrl = null;
    }
  }

  return {
    kind: "news",
    url,
    domain: domainOf(url),
    proof: true,
    title: title.slice(0, 160),
    description:
      (meta(html, "og:description") ?? meta(html, "description"))?.slice(0, 220) ?? null,
    imageUrl,
  };
}

/* ---------------------------------------------------------- solscan ------ */

/** What a row is called: a coin has a symbol, a tokenized stock a ticker. */
function tickerOf(asset: Asset): string {
  return asset.kind === "stock" ? asset.ticker : asset.symbol;
}

/** Symbols for the mints in a trade, from the store where there is a row. */
async function symbolsFor(mints: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const mint of mints) {
    const base = BASE_SYMBOL.get(mint);
    if (base) out.set(mint, base);
  }

  const unknown = mints.filter((mint) => !out.has(mint));
  if (unknown.length === 0) return out;

  try {
    const {universeFor} = await import("./holdings");
    for (const [mint, asset] of await universeFor(unknown)) {
      const symbol = tickerOf(asset);
      if (symbol) out.set(mint, symbol);
    }
  } catch {
    // A symbol is decoration. The amount and the side are the facts.
  }

  for (const mint of unknown) {
    if (!out.has(mint)) out.set(mint, shortAddress(mint, 4));
  }
  return out;
}

/**
 * A transaction, decoded into what the wallet actually did.
 *
 * Read with the same rules as the Stonkfolio — balance changes, not the
 * provider's label — so a card says the same thing the holdings do.
 */
async function txCard(link: CommentLink, mint: string | null): Promise<TxCard | null> {
  // Read raw from the node, not through the parse tier. The reducer in
  // `rawTransactions` returns the same shape for a fraction of the cost, and
  // it keeps a posted link off the quota the indexer runs on.
  const {transactions} = await rawTransactions([link.ref]);
  const tx = transactions[0];
  if (!tx || tx.transactionError) return null;

  const trades = tradesFromTx(tx, tx.feePayer);
  if (trades.length === 0) return null;

  // The trade in the coin being discussed, when there is one. Otherwise the
  // biggest leg that is not the thing it was paid with.
  const about = mint ? trades.find((trade) => trade.mint === mint) : null;
  const trade =
    about ??
    trades.find((entry) => !BASE_MINTS.has(entry.mint)) ??
    trades[0];

  const [symbols, valued] = await Promise.all([
    symbolsFor([trade.mint, trade.paidMint]),
    valueOf(trade),
  ]);

  const verb = trade.side === "buy" ? "Bought" : "Sold";
  const symbol = symbols.get(trade.mint) ?? "";
  const got = `${compact(trade.amount)} ${symbol}`.trim();
  const paid = `${units(trade.paidAmount)} ${symbols.get(trade.paidMint) ?? ""}`.trim();

  return {
    kind: "solscan-tx",
    url: link.url,
    domain: "solscan.io",
    proof: txIsProof(trades, mint),
    side: trade.side,
    // What it was worth, which is the number anyone reading a comment is
    // weighing. The units fall back to the headline only when nothing could
    // price it — a figure in SOL is still a fact, and inventing a dollar
    // amount from a missing price would not be.
    headline:
      valued === null
        ? `${verb} ${got} for ${paid}`
        : `${verb} ${compactMoney(valued)} of ${symbol}`.trim(),
    amount: valued === null ? null : got,
    when: relativeTime(trade.at),
    who: shortAddress(tx.feePayer, 4),
  };
}

/**
 * A wallet, described by what it holds of this coin and whether it has sold.
 *
 * Facts the store cannot support are not stated at all. There is no
 * "probably" on a card whose whole job is to be checkable.
 */
async function walletCard(link: CommentLink, mint: string | null): Promise<WalletCard | null> {
  const wallet = asPubkey(link.ref);
  if (!wallet || !mint) return null;
  const coin = asPubkey(mint);
  if (!coin) return null;

  const facts: string[] = [];
  let holds = 0;
  let symbol = "";

  try {
    const [{balancesFor, universeFor}] = await Promise.all([import("./holdings")]);
    const [balances, universe] = await Promise.all([
      balancesFor(wallet, [coin]),
      universeFor([mint]),
    ]);
    const asset = universe.get(mint);
    symbol = asset ? tickerOf(asset) : "";

    const held = balances.tokens[mint];
    holds = held ? Number(held.amount) / 10 ** held.decimals : 0;

    const supply = asset && asset.kind === "stonk" ? asset.circulatingSupply : null;
    if (holds > 0 && supply && supply > 0) {
      facts.push(`Holds ${((holds / supply) * 100).toFixed(1)}% of ${symbol}`.trim());
    } else if (holds > 0) {
      facts.push(`Holds ${compact(holds)} ${symbol}`.trim());
    } else {
      facts.push(`Holds no ${symbol}`.trim());
    }
  } catch {
    return null;
  }

  let traded = 0;
  try {
    const {walletHistory} = await import("./walletTrades");
    // Read only. A link preview never syncs a stranger's history into the
    // store, so a wallet nobody has looked at simply has no second line.
    const trades = await walletHistory(wallet, {mint: coin, limit: 100});
    traded = trades.length;

    const sold = trades.find((trade) => trade.side === "sell");
    const oldest = trades[trades.length - 1];

    if (sold) facts.push(`Last sold ${relativeTime(sold.at)}`);
    else if (oldest) facts.push(`No sells in ${daysSince(oldest.at)}`);
  } catch {
    // No stored history for this wallet. The balance still stands on its own.
  }

  return {
    kind: "solscan-account",
    url: link.url,
    domain: "solscan.io",
    proof: walletIsProof({holds, trades: traded}),
    address: shortAddress(link.ref, 4),
    facts,
  };
}

function daysSince(iso: string): string {
  const days = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return days === 1 ? "a day" : `${days} days`;
}

/**
 * What a trade was worth in dollars, priced the way the Stonkfolio prices it.
 *
 * SOL at its price that minute, stables at face, and a tokenized stock at
 * spot — the same rules the stored history uses, so a card and a holding never
 * disagree about the same trade. Null when none of them apply.
 */
async function valueOf(trade: RawTrade): Promise<number | null> {
  try {
    const [{solUsdAt}, {stockUsdMap}] = await Promise.all([
      import("./gecko"),
      import("./walletTrades"),
    ]);
    const [solUsd, mintUsd] = await Promise.all([
      solUsdAt(Math.floor(Date.parse(trade.at) / 1000)).catch(() => null),
      stockUsdMap([trade]).catch(() => new Map<string, number>()),
    ]);
    return valueTrade(trade, solUsd, mintUsd).valueUsd;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ public ----- */

/**
 * One card, resolved or plain.
 *
 * `mint` is the coin the comment sits under, and null in the feed where a
 * comment is shown away from its coin. Without it a Solscan link cannot earn
 * proof, which is the right answer rather than a missing one.
 */
export async function resolveCard(
  link: CommentLink,
  mint: string | null,
): Promise<LinkCard> {
  // Keyed by mint as well: a wallet card says different things under different
  // coins, and proof is decided per coin. The version is in the key so that
  // changing what a card holds cannot serve the old shape to a new reader.
  const key = `linkcard:v1:${mint ?? ""}:${link.url}`;

  try {
    return await remember(key, async () => {
      switch (link.kind) {
        case "x":
          /*
           * The public embed first, the API second.
           *
           * Both answer the same question, but the bearer token is shared with
           * the news tab's search and its free-tier window is counted in
           * requests. Spending it on comment cards would empty the rail of
           * real posts, so the endpoint that costs nothing is asked first.
           */
          return (
            (await tweetFromEmbed(link.url).catch(() => null)) ??
            (await tweetFromApi(link.ref).catch(() => null)) ??
            plainCard(link.url)
          );
        case "news":
          return (await newsCard(link.url)) ?? plainCard(link.url);
        case "solscan-tx":
          return (await txCard(link, mint)) ?? plainCard(link.url);
        case "solscan-account":
          return (await walletCard(link, mint)) ?? plainCard(link.url);
      }
    });
  } catch {
    return plainCard(link.url);
  }
}

/**
 * Read a card from the shared store, or resolve it once and keep it.
 *
 * Falls back to the in-process cache where there is no Redis — local, and the
 * worker — so the behaviour is the same everywhere, just not shared.
 */
async function remember(key: string, load: () => Promise<LinkCard>): Promise<LinkCard> {
  if (!kvUsable()) return (await cached<LinkCard>(key, TTL_SECONDS * 1_000, load)).value;

  const stored = await kvGet<LinkCard>(key);
  if (stored) return stored;

  const card = await load();
  // Awaited, not detached: a serverless function can freeze the moment it
  // returns, and a floating write would be dropped mid-flight. `kvSet` never
  // throws, so this costs a few milliseconds and can never fail a card.
  const kept = await kvSet(key, card, TTL_SECONDS);

  // The store just failed, so keep this one here instead. Without it the next
  // reader on this instance would resolve the same link again purely because
  // the write it could not make was the only copy.
  if (!kept) await cached<LinkCard>(key, TTL_SECONDS * 1_000, async () => card);

  return card;
}

/** Every link in a comment, resolved at once and capped. */
export async function resolveCards(
  links: readonly CommentLink[],
  mint: string | null,
): Promise<LinkCard[]> {
  return Promise.all(
    links.slice(0, MAX_CARDS).map((link) => resolveCard(link, mint)),
  );
}
