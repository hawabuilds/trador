/**
 * Jupiter's price endpoint, which turns out to carry most of a feed row.
 *
 * Beyond the price it returns `priceChange24h`, real pool `liquidity` in USD,
 * the mint's `createdAt`, and — usefully — its own `launchpad` attribution.
 * That last field is not used to decide anything: attribution comes from
 * program-owned account state, because a provider's label is exactly the kind
 * of third-party claim this app refuses to build on. It is kept only as a
 * cross-check, so a disagreement between Jupiter and the pool data becomes
 * visible instead of silent.
 */

import type {Pubkey} from "@/lib/pubkey";

export interface JupPrice {
  usdPrice: number | null;
  priceChange24h: number | null;
  /** Real pool liquidity in USD. Not a bonding-curve reserve. */
  liquidity: number | null;
  createdAt: string | null;
  decimals: number | null;
  /** Jupiter's own launchpad label — corroboration only, never authority. */
  launchpad: string | null;
  /** Present for tokenized stocks: the underlying equity's own figures. */
  underlying: {price: number | null; mcap: number | null; source: string} | null;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export async function jupiterPrices(
  mints: Pubkey[],
): Promise<Map<string, JupPrice>> {
  const out = new Map<string, JupPrice>();

  for (let i = 0; i < mints.length; i += 50) {
    const batch = mints.slice(i, i + 50);
    try {
      /**
       * Retry on a rate limit rather than skipping the batch.
       *
       * The free endpoint throttles after a few hundred mints, and the first
       * version of this silently `continue`d — which turned a throttle into
       * "every stock has no price" and looked like the registry was broken
       * rather than the request.
       */
      let response: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        response = await fetch(
          `https://lite-api.jup.ag/price/v3?ids=${batch.join(",")}`,
        );
        if (response.ok) break;
        if (response.status !== 429 && response.status < 500) break;
        await new Promise((resolve) => setTimeout(resolve, 4000 * 2 ** attempt));
      }
      if (!response?.ok) {
        console.warn(
          `  jupiter: batch of ${batch.length} failed (${response?.status ?? "no response"})`,
        );
        continue;
      }

      const body = (await response.json()) as Record<string, Record<string, unknown>>;
      for (const [mint, row] of Object.entries(body)) {
        if (!row) continue;
        const stockData = row.stockData as Record<string, unknown> | undefined;

        out.set(mint, {
          usdPrice: num(row.usdPrice),
          priceChange24h: num(row.priceChange24h),
          liquidity: num(row.liquidity),
          createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
          decimals: num(row.decimals),
          launchpad: typeof row.launchpad === "string" ? row.launchpad : null,
          underlying: stockData
            ? {
                price: num(stockData.price),
                mcap: num(stockData.mcap),
                source: String(stockData.id ?? "unknown"),
              }
            : null,
        });
      }
    } catch {
      // A missing price stays absent rather than becoming zero. Every consumer
      // treats absence as "unknown" and says so on screen.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return out;
}
