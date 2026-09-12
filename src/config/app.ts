export const APP_NAME = "Trador";
export const APP_TAGLINE = "Coins priced in stocks, on Solana";
export const APP_SUBTITLE =
  "Every tokenized stock, and every coin launched against one — in one feed.";

/** Hostname for share copy when NEXT_PUBLIC_APP_URL is unset. */
export const APP_DOMAIN = "trador.fun";

/**
 * The app's two asset words, which are load-bearing everywhere in the copy.
 *
 * `Stock` is a verified tokenized equity, ETF, commodity or pre-IPO name —
 * something with a custodian behind it. `Stonk` is a launchpad coin priced
 * against one. Keeping them distinct is the whole reason a newcomer can read
 * this app at all: one of the two is backed by an asset and the other is not,
 * and a shared word would hide exactly that.
 */
export const STOCK_WORD = {one: "Stock", many: "Stocks"} as const;
export const STONK_WORD = {one: "Stonk", many: "Stonks"} as const;

/**
 * The five destinations. Labels are for screen readers and tooltips only — the
 * bar itself is icons, so each has to be unambiguous alone.
 *
 * The watchlist is not here: it lives inside the feed as a tab, where it is
 * read against the same rows it filters.
 */
export const TABS = [
  {href: "/home", label: "Home", key: "home"},
  {href: "/search", label: "Search", key: "search"},
  {href: "/news", label: "News", key: "news"},
  {href: "/learn", label: "Learn", key: "learn"},
  {href: "/stonkfolio", label: "Stonkfolio", key: "stonkfolio"},
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/** The home feed's three tabs. */
export const HOME_TABS = [
  {key: "watchlist", label: "Watchlist"},
  {key: "stonks", label: "Stonks"},
  {key: "stocks", label: "Stocks"},
] as const;

export type HomeTabKey = (typeof HOME_TABS)[number]["key"];
