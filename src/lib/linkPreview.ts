/**
 * What a link in a comment is, decided from the URL alone.
 *
 * Pure and shared: the client uses it to know whether to ask for a card at
 * all, and the server uses the same answer to decide what to resolve. A link
 * nobody recognises is still shown, as a plain card with its domain — the
 * alternative is a comment whose evidence silently disappears.
 */

export type LinkKind = "x" | "solscan-tx" | "solscan-account" | "news";

export interface CommentLink {
  /** The URL as written, after trimming trailing punctuation. */
  url: string;
  kind: LinkKind;
  /** Status id, signature or address, by kind. Empty for news. */
  ref: string;
}

/** Hosts whose posts we can resolve without a key. */
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.x.com"]);
const SOLSCAN_HOSTS = new Set(["solscan.io", "www.solscan.io"]);

/** Base58, which is what Solana signatures and addresses are. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Links in a comment, in the order they appear.
 *
 * Trailing punctuation is trimmed, because people write "look at this
 * https://x.com/a/status/1." and the full stop is not part of the link.
 */
export function linksIn(body: string): CommentLink[] {
  const found: CommentLink[] = [];
  const matches = body.match(/https?:\/\/[^\s<>"']+/gi) ?? [];

  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?)\]}]+$/, "");
    const link = classifyLink(url);
    if (link && !found.some((seen) => seen.url === link.url)) found.push(link);
  }

  return found;
}

/** What one link is, or null when it is not a link we can show at all. */
export function classifyLink(url: string): CommentLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (X_HOSTS.has(host)) {
    // /<handle>/status/<id>, which is the only X link with anything to show.
    const at = parts.indexOf("status");
    const id = at >= 0 ? parts[at + 1] : undefined;
    return id && /^\d+$/.test(id) ? {url, kind: "x", ref: id} : null;
  }

  if (SOLSCAN_HOSTS.has(host)) {
    const [section, value] = parts;
    if (!value || !BASE58.test(value)) return null;
    if (section === "tx") return {url, kind: "solscan-tx", ref: value};
    if (section === "account" || section === "address" || section === "token") {
      return {url, kind: "solscan-account", ref: value};
    }
    return null;
  }

  return {url, kind: "news", ref: ""};
}

/** The domain, for a card that could not be resolved into anything better. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A resolved card.
 *
 * `proof` is the only field the rest of the app reasons about: it says this
 * link actually backs the claim, rather than merely sitting under it. A
 * Solscan link earns it by involving the coin's own mint, and an X or news
 * link by resolving at all. Everything else renders as a plain card — visible,
 * clickable, and worth nothing as evidence.
 */
interface CardBase {
  url: string;
  domain: string;
  proof: boolean;
}

export interface XCard extends CardBase {
  kind: "x";
  author: string;
  handle: string;
  text: string;
  postedAt: string | null;
}

export interface NewsCard extends CardBase {
  kind: "news";
  title: string;
  description: string | null;
  imageUrl: string | null;
}

export interface TxCard extends CardBase {
  kind: "solscan-tx";
  /** Colours the headline, and null when the transaction was not a trade. */
  side: "buy" | "sell" | null;
  headline: string;
  /** Units traded, when the headline is in dollars. Null when it is not. */
  amount: string | null;
  /** The grey line under it: when, and whose wallet. */
  when: string;
  who: string;
}

export interface WalletCard extends CardBase {
  kind: "solscan-account";
  address: string;
  /** Short statements about this wallet and the coin, in reading order. */
  facts: string[];
}

/** Anything that could not be resolved: the domain, and the link. */
export interface PlainCard extends CardBase {
  kind: "link";
}

export type LinkCard = XCard | NewsCard | TxCard | WalletCard | PlainCard;

/** The card a link falls back to when nothing better could be resolved. */
export function plainCard(url: string): PlainCard {
  return {kind: "link", url, domain: domainOf(url), proof: false};
}

/**
 * Whether a decoded transaction proves anything about this coin.
 *
 * The rule is the coin's own mint, on either side of a leg: somebody's very
 * real trade in a different coin is still not evidence for this one, and a
 * card that credited it would make the strongest signal in the app the easiest
 * to fake. Without a coin in context — the Feed, where a comment is read away
 * from its asset — nothing can be proof.
 */
export function txIsProof(
  legs: readonly {mint: string; paidMint: string}[],
  mint: string | null,
): boolean {
  if (!mint) return false;
  return legs.some((leg) => leg.mint === mint || leg.paidMint === mint);
}

/**
 * Whether a wallet proves anything about this coin.
 *
 * Holding it, or having traded it. An address that has never touched the coin
 * is a link to a page, however impressive its balance.
 */
export function walletIsProof(found: {holds: number; trades: number}): boolean {
  return found.holds > 0 || found.trades > 0;
}
