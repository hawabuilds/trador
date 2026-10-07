/**
 * What each issuer says it has listed, from the issuer's own source.
 *
 * The census finds a stock once somebody launches a coin against it, and the
 * authority sweep finds whatever the issuer's key has minted that an index
 * happens to know about. Neither sees a stock the day it is listed, which is
 * how Trador came to carry 24 xStocks out of 1,109.
 *
 * So the issuers are asked directly. This only ever *proposes* mints — each
 * one still has to be minted by a recognised authority, carry a resolvable
 * ticker, not be retired paper, and pass the tradability screen. A catalogue
 * that lied about an address would produce a mint that fails the authority
 * check, which is the same answer as not having asked.
 *
 * Deliberately not a token list, an aggregator or a search: those carry
 * copycats under the real tickers, and the whole registry exists to keep those
 * out.
 */

/** xStocks publishes its catalogue as the data behind its own products page. */
async function xstocks(): Promise<string[]> {
  const page = await fetch("https://xstocks.com/products", {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent": "TradorStockSync/1.0 (+https://trador.one)"},
  });
  if (!page.ok) throw new Error(`xstocks.com returned ${page.status}`);

  // The page is a Next.js build; its data lives under the build id it was
  // compiled with, so the id is read from the page rather than pinned.
  const html = await page.text();
  const buildId = html.match(/"buildId":"([^"]+)"/)?.[1];
  if (!buildId) throw new Error("xstocks.com did not expose a build id");

  const data = await fetch(`https://xstocks.com/_next/data/${buildId}/products.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent": "TradorStockSync/1.0 (+https://trador.one)"},
  });
  if (!data.ok) throw new Error(`xstocks product data returned ${data.status}`);

  const body = (await data.json()) as {
    pageProps?: {products?: {addresses?: {solana?: string | null}}[]};
  };

  return (body.pageProps?.products ?? [])
    .map((product) => product.addresses?.solana)
    .filter((mint): mint is string => typeof mint === "string" && mint.length > 0);
}

/**
 * Backpack publishes its tokenized equities on its own asset endpoint.
 *
 * They are the entries whose symbol ends in `.US`, each carrying the Solana
 * mint it settles to. Most of them hold nothing and cannot be withdrawn — they
 * are listed long before they trade — and the tradability screen is what tells
 * those apart.
 */
async function backpack(): Promise<string[]> {
  const response = await fetch("https://api.backpack.exchange/api/v1/assets", {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    headers: {"user-agent": "TradorStockSync/1.0 (+https://trador.one)"},
  });
  if (!response.ok) throw new Error(`backpack assets returned ${response.status}`);

  const body = (await response.json()) as {
    symbol?: string;
    tokens?: {blockchain?: string; contractAddress?: string}[];
  }[];

  const mints: string[] = [];
  for (const asset of body ?? []) {
    if (!asset.symbol?.endsWith(".US")) continue;
    const token = (asset.tokens ?? []).find((t) => t.blockchain === "Solana" && t.contractAddress);
    if (token?.contractAddress) mints.push(token.contractAddress);
  }
  return mints;
}

/**
 * Every mint the issuers currently list, as candidates.
 *
 * A catalogue that cannot be reached is reported and skipped rather than
 * failing the sync: the census and the authority sweep still run, so the worst
 * case is the registry not growing this time.
 */
export async function catalogueMints(
  onProgress: (line: string) => void = () => {},
): Promise<string[]> {
  const sources: [string, () => Promise<string[]>][] = [
    ["xStocks", xstocks],
    ["Backpack Securities", backpack],
  ];

  const all: string[] = [];
  for (const [label, load] of sources) {
    try {
      const mints = await load();
      onProgress(`${label}: ${mints.length} listed on Solana`);
      for (const mint of mints) all.push(mint);
    } catch (error) {
      onProgress(`${label}: unreachable (${(error as Error).message})`);
    }
  }

  return [...new Set(all)];
}
