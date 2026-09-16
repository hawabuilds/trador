/**
 * DexScreener, used for one thing: the project links Jupiter does not carry.
 *
 * Jupiter's token API is the primary source for metadata here — it batches
 * forty mints a call and returns name, artwork, supply and price together. What
 * it does not return is telegram or discord at all, and its `twitter` and
 * `website` are present on roughly half the universe. DexScreener carries the
 * links a creator entered on the pair, which is a different pile of the same
 * kind of data, and the two overlap only partly.
 *
 * So this is a **fallback**, never a replacement. It is asked only about coins
 * that are still missing links after Jupiter has spoken, which bounds the work
 * to a shrinking set rather than the whole universe on every pass.
 *
 * Nothing here decides what a coin *is*. Links are the one field a creator
 * controls completely, so they are cosmetic by definition — the attribution
 * that matters is still proved from chain state.
 */

import type {Pubkey} from "@/lib/pubkey";
import type {SocialLinks} from "@/lib/types";

import {collectLinks} from "./socialLinks";

/** DexScreener's documented ceiling for the batch token endpoint. */
const BATCH = 30;

interface DexPair {
  baseToken?: {address?: string};
  liquidity?: {usd?: number};
  priceChange?: {h24?: number};
  info?: {
    websites?: {url?: string}[];
    socials?: {type?: string; url?: string}[];
  };
}

/** What DexScreener can tell us that Jupiter did not. */
export interface DexFill {
  links: Partial<SocialLinks>;
  /** 24h price change, percent. Null when no pair reported one. */
  priceChange24h: number | null;
}

/**
 * The links on one pair, in the shape the store holds.
 *
 * Both piles of URLs go through the shared classifier, so a link lands in the
 * slot its host earns rather than the slot it was filed under.
 */
function socialsFrom(pair: DexPair): Partial<SocialLinks> {
  return collectLinks([
    ...(pair.info?.socials ?? []).map((entry) => ({url: entry.url, type: entry.type})),
    ...(pair.info?.websites ?? []).map((site) => ({url: site.url})),
  ]);
}

/**
 * What DexScreener knows about a set of mints, as far as it goes.
 *
 * Returns only mints it had something for. A failure yields an empty map rather
 * than throwing: these links are decoration, and losing them must not cost the
 * decorate pass its prices.
 *
 * Returns only mints it had something for. A failure yields an empty map rather
 * than throwing: none of this is load-bearing, and losing it must not cost the
 * decorate pass its prices.
 */
export async function dexscreenerFill(
  mints: readonly Pubkey[],
): Promise<Map<string, DexFill>> {
  const found = new Map<string, DexFill>();
  if (mints.length === 0) return found;

  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);

    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`,
        {cache: "no-store", signal: AbortSignal.timeout(8_000)},
      );
      if (!response.ok) {
        console.warn(`dexscreener fill -> ${response.status}`);
        continue;
      }

      const body = (await response.json()) as {pairs?: DexPair[] | null};

      /*
       * A token usually has several pairs, and they disagree.
       *
       * The deepest pair wins the price change: a percentage off a pool with
       * four hundred dollars in it is noise, and printing it next to a real
       * market cap would be the thin-pool pricing this codebase refuses
       * everywhere else. Links take the first pair that carries any, since
       * those are the same creator entry duplicated across venues.
       */
      const deepest = new Map<string, number>();

      for (const pair of body.pairs ?? []) {
        const mint = pair.baseToken?.address;
        if (!mint) continue;

        const current = found.get(mint) ?? {links: {}, priceChange24h: null};

        const links = socialsFrom(pair);
        for (const [slot, url] of Object.entries(links)) {
          if (url && !current.links[slot as keyof SocialLinks]) {
            current.links[slot as keyof SocialLinks] = url;
          }
        }

        const change = pair.priceChange?.h24;
        const depth = pair.liquidity?.usd ?? 0;
        if (typeof change === "number" && Number.isFinite(change)) {
          if (!deepest.has(mint) || depth > (deepest.get(mint) ?? 0)) {
            deepest.set(mint, depth);
            current.priceChange24h = change;
          }
        }

        found.set(mint, current);
      }

      // Drop mints nothing was actually learned about, so the caller can tell
      // "no data" from "not asked".
      for (const [mint, fill] of found) {
        const empty =
          fill.priceChange24h === null &&
          !fill.links.x &&
          !fill.links.telegram &&
          !fill.links.discord &&
          !fill.links.website;
        if (empty) found.delete(mint);
      }
    } catch (error) {
      console.warn("dexscreener fill failed", (error as Error).message);
    }
  }

  return found;
}
