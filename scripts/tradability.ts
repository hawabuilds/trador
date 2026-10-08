/**
 * Whether a verified stock can actually be bought on Trador.
 *
 * Verification answers "is this really Broadcom's token". It does not answer
 * "can anyone trade it", and after xStocks listed over a thousand names the
 * difference stopped being academic: 1,047 of them have no pool on Solana at
 * all. Listing those would fill the Stocks tab with rows that quote a price
 * and refuse every order.
 *
 * Two passes, cheapest first, because the expensive one does not need to see
 * most of the list:
 *
 *   1. **Liquidity.** One DexScreener call per 30 mints says which have a pool
 *      worth anything. A thousand mints is 37 calls and about a minute.
 *   2. **A real quote.** Jupiter is asked for a $250 buy on what survives. The
 *      route and its price impact are the actual test — liquidity is only how
 *      the list gets small enough to ask.
 *
 * DexScreener is a liquidity filter here and nothing else. Which mint is real
 * was settled by the issuer's own key before this runs, so a copycat with a
 * deep pool still never reaches this step.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Mints per DexScreener call, which is what its tokens endpoint accepts. */
const SCREEN_BATCH = 30;

/** A quote this size is what a person actually buys. */
const QUOTE_USD = 250;

export interface Tradability {
  liquidityUsd: number;
  /** Price impact on a $250 buy, as a percentage. Null when nothing routed. */
  impactPct: number | null;
  priceUsd: number | null;
  ok: boolean;
  /** Why it failed, for the report. Null when it passed. */
  why: "no pool" | "thin pool" | "no route" | "impact too high" | "no price" | null;
}

export interface TradabilityLimits {
  minLiquidityUsd: number;
  maxImpactPct: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deepest pool per mint, in dollars. Mints with none are simply absent. */
async function liquidityByMint(mints: readonly string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();

  for (let i = 0; i < mints.length; i += SCREEN_BATCH) {
    const batch = mints.slice(i, i + SCREEN_BATCH);
    try {
      const response = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`,
        {cache: "no-store", signal: AbortSignal.timeout(15_000)},
      );
      if (response.status === 429) {
        await sleep(3_000);
        i -= SCREEN_BATCH;
        continue;
      }
      if (!response.ok) continue;

      const pairs = (await response.json()) as {
        baseToken?: {address?: string};
        liquidity?: {usd?: number};
      }[];

      for (const pair of pairs ?? []) {
        const mint = pair.baseToken?.address;
        const usd = Number(pair.liquidity?.usd ?? 0);
        if (!mint || !Number.isFinite(usd)) continue;
        found.set(mint, Math.max(found.get(mint) ?? 0, usd));
      }
    } catch {
      // A batch that could not be screened leaves its mints unknown, which
      // reads as no pool and keeps them out. Quiet rather than wrong.
    }
    await sleep(250);
  }

  return found;
}

interface Quoted {
  routed: boolean;
  impactPct: number | null;
}

async function quote(mint: string, base: string, key: string): Promise<Quoted> {
  const url =
    `${base}/swap/v1/quote?inputMint=${USDC}&outputMint=${mint}` +
    `&amount=${QUOTE_USD * 1e6}&slippageBps=100&restrictIntermediateTokens=true`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {accept: "application/json", ...(key ? {"x-api-key": key} : {})},
    });
    if (response.status === 429) {
      await sleep(1_500 * (attempt + 1));
      continue;
    }
    if (!response.ok) return {routed: false, impactPct: null};

    const body = (await response.json()) as {
      routePlan?: unknown[];
      priceImpactPct?: string | number;
    };
    if (!body.routePlan?.length) return {routed: false, impactPct: null};
    return {routed: true, impactPct: Number(body.priceImpactPct ?? 0) * 100};
  }

  return {routed: false, impactPct: null};
}

/** The price the feed would show, from the source the feed uses. */
async function pricesFor(
  mints: readonly string[],
  base: string,
  key: string,
): Promise<Map<string, number>> {
  const found = new Map<string, number>();

  for (let i = 0; i < mints.length; i += 50) {
    const batch = mints.slice(i, i + 50);
    try {
      const response = await fetch(`${base}/price/v3?ids=${batch.join(",")}`, {
        cache: "no-store",
        headers: {accept: "application/json", ...(key ? {"x-api-key": key} : {})},
      });
      if (!response.ok) continue;
      const body = (await response.json()) as Record<string, {usdPrice?: number} | undefined>;
      for (const mint of batch) {
        const price = Number(body[mint]?.usdPrice ?? 0);
        if (price > 0) found.set(mint, price);
      }
    } catch {
      // No price is a failure the caller reports, not one to throw over.
    }
    await sleep(200);
  }

  return found;
}

/**
 * Screen a set of mints, cheapest test first.
 *
 * `onProgress` exists because this is the slow half of a sync and a minute of
 * silence reads as a hang.
 */
export async function screenTradability(
  mints: readonly string[],
  limits: TradabilityLimits,
  onProgress: (line: string) => void = () => {},
): Promise<Map<string, Tradability>> {
  const out = new Map<string, Tradability>();
  if (mints.length === 0) return out;

  const base = process.env.JUPITER_API_URL ?? (process.env.JUPITER_API_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag");
  const key = process.env.JUPITER_API_KEY ?? "";

  onProgress(`screening ${mints.length} mint(s) for liquidity`);
  const liquidity = await liquidityByMint(mints);

  const survivors: string[] = [];
  for (const mint of mints) {
    const usd = liquidity.get(mint) ?? 0;
    if (usd <= 0) out.set(mint, {liquidityUsd: 0, impactPct: null, priceUsd: null, ok: false, why: "no pool"});
    else if (usd < limits.minLiquidityUsd)
      out.set(mint, {liquidityUsd: usd, impactPct: null, priceUsd: null, ok: false, why: "thin pool"});
    else survivors.push(mint);
  }

  onProgress(
    `  ${survivors.length} with $${limits.minLiquidityUsd.toLocaleString()} or more, quoting each`,
  );

  const prices = await pricesFor(survivors, base, key);

  for (const [index, mint] of survivors.entries()) {
    const {routed, impactPct} = await quote(mint, base, key);
    const priceUsd = prices.get(mint) ?? null;
    const liquidityUsd = liquidity.get(mint) ?? 0;

    const why: Tradability["why"] = !routed
      ? "no route"
      : (impactPct ?? 99) >= limits.maxImpactPct
        ? "impact too high"
        : priceUsd === null
          ? "no price"
          : null;

    out.set(mint, {liquidityUsd, impactPct, priceUsd, ok: why === null, why});
    if ((index + 1) % 10 === 0) onProgress(`  quoted ${index + 1} of ${survivors.length}`);
    await sleep(700);
  }

  return out;
}
