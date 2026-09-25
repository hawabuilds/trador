/**
 * Jupiter's token API — metadata, artwork, supply and stats in one call.
 *
 * This replaced three separate lookups: a Metaplex metadata PDA read for the
 * name and image, a mint account read for supply and decimals, and the price
 * endpoint for figures. It batches, it returns `icon` already resolved from
 * whatever IPFS or Irys gateway the creator used, and it reports `circSupply`
 * directly — so a market cap needs one request rather than a fan-out.
 *
 * One thing is still read from the chain rather than taken from here, and it is
 * deliberate: **attribution**. This endpoint reports a `launchpad` field, and
 * it agrees with our pool-derived answer on every coin in the universe — but a
 * provider's label is exactly the kind of third-party claim the app refuses to
 * build on, so it is captured as a cross-check and never as the authority.
 */

import type {Pubkey} from "@/lib/pubkey";
import {cached} from "./cache";
import {JUPITER_API_BASE, jupiterFetchHeaders} from "./jupiterEnv";

/** Jupiter's search endpoint accepts a comma list; this is a safe batch size. */
const BATCH = 40;

export interface JupToken {
  mint: Pubkey;
  symbol: string | null;
  name: string | null;
  /** Artwork, already resolved to a fetchable URL. */
  icon: string | null;
  decimals: number | null;
  tokenProgram: string | null;
  circSupply: number | null;
  usdPrice: number | null;
  liquidity: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  /** One-hour USD volume from Jupiter `stats1h` buy + sell. */
  volume1hUsd: number | null;
  /** Buys + sells in the 24h window, when Jupiter reports counts. */
  txs24h: number | null;
  /** Distinct traders in 24h (`numTraders`). */
  uniqueMakers24h: number | null;
  priceChange24h: number | null;
  holderCount: number | null;
  createdAt: string | null;
  /**
   * The project's own links, when the token's metadata carried them.
   *
   * Only `twitter` and `website` — Jupiter does not surface telegram or
   * discord, and across a sample of the live universe those two cover roughly
   * 60% and 30% of coins respectively. Absent is absent: a missing link renders
   * as nothing rather than as a dead icon.
   */
  twitter: string | null;
  website: string | null;
  /** Corroboration only — never the authority. See the note above. */
  launchpad: string | null;
  /** Jupiter's own risk read. Surfaced, not acted on. */
  organicScoreLabel: string | null;
}

const num = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * A link, or nothing.
 *
 * Creator-supplied metadata is the one field on a coin that an attacker fully
 * controls, so anything that is not a plain http(s) URL is dropped rather than
 * cleaned up — `javascript:` in an `href` is the whole reason this is not just
 * `str()`.
 */
function httpUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

function windowVolume(day: Record<string, unknown>): number | null {
  const buy = num(day.buyVolume) ?? 0;
  const sell = num(day.sellVolume) ?? 0;
  const volume = buy + sell;
  return volume > 0 ? volume : null;
}

function windowTxs(day: Record<string, unknown>): number | null {
  const buys = num(day.numBuys) ?? 0;
  const sells = num(day.numSells) ?? 0;
  const total = buys + sells;
  return total > 0 ? total : null;
}

function parse(row: Record<string, unknown>): JupToken | null {
  const mint = str(row.id);
  if (!mint) return null;

  const day = (row.stats24h ?? {}) as Record<string, unknown>;
  const hour = (row.stats1h ?? {}) as Record<string, unknown>;
  const volume = windowVolume(day);

  return {
    mint: mint as Pubkey,
    symbol: str(row.symbol),
    name: str(row.name),
    icon: str(row.icon),
    decimals: num(row.decimals),
    tokenProgram: str(row.tokenProgram),
    circSupply: num(row.circSupply) ?? num(row.totalSupply),
    usdPrice: num(row.usdPrice),
    liquidity: num(row.liquidity),
    marketCapUsd: num(row.mcap) ?? num(row.fdv),
    // Zero volume and unknown volume are different facts; only report a number
    // when the window actually carried one.
    volume24hUsd: volume,
    volume1hUsd: windowVolume(hour),
    txs24h: windowTxs(day),
    uniqueMakers24h: (() => {
      const traders = num(day.numTraders);
      return traders !== null && traders > 0 ? traders : null;
    })(),
    priceChange24h: num(day.priceChange),
    holderCount: num(row.holderCount),
    createdAt: str(row.createdAt),
    twitter: httpUrl(row.twitter),
    website: httpUrl(row.website),
    launchpad: str(row.launchpad),
    organicScoreLabel: str(row.organicScoreLabel),
  };
}

async function fetchBatch(mints: Pubkey[]): Promise<JupToken[]> {
  /**
   * Retry a rate limit rather than skipping the batch.
   *
   * Skipping turns a throttle into "every coin has no price", which reads as a
   * broken universe rather than a busy endpoint — and that is exactly how an
   * earlier version of this silently produced a feed of dashes.
   */
  let response: Response | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(
      `${JUPITER_API_BASE}/tokens/v2/search?query=${mints.join(",")}`,
      {
        headers: jupiterFetchHeaders(),
        cache: "no-store",
      },
    );
    if (response.ok) break;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
  }

  if (!response?.ok) {
    throw new Error(`Token API returned ${response?.status ?? "no response"}.`);
  }

  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body) ? body : ((body as {tokens?: unknown[]}).tokens ?? []);

  return (rows as Record<string, unknown>[])
    .map(parse)
    .filter((token): token is JupToken => token !== null);
}

export async function jupTokens(mints: Pubkey[]): Promise<Map<string, JupToken>> {
  const out = new Map<string, JupToken>();

  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);
    const key = `juptokens:${batch[0]}:${batch.length}`;

    try {
      const {value} = await cached(key, 30_000, () => fetchBatch(batch));
      for (const token of value) out.set(token.mint, token);
    } catch {
      // A batch that could not be decorated leaves those rows as the store has
      // them. A provider may only ever cost decoration, never a row.
    }

    if (i + BATCH < mints.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return out;
}

/** One mint, for a single asset page. */
export async function jupToken(mint: Pubkey): Promise<JupToken | null> {
  const map = await jupTokens([mint]);
  return map.get(mint) ?? null;
}
