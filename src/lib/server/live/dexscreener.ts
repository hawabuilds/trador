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
  info?: {
    websites?: {url?: string}[];
    socials?: {type?: string; url?: string}[];
  };
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
 * Project links for a set of mints, as far as DexScreener knows them.
 *
 * Returns only mints it had something for. A failure yields an empty map rather
 * than throwing: these links are decoration, and losing them must not cost the
 * decorate pass its prices.
 *
 * A token usually has several pairs. The first one carrying any links wins —
 * they are the same creator's entry duplicated across venues, and merging them
 * would mean choosing between two values for the same field with no way to tell
 * which is newer.
 */
export async function dexscreenerSocials(
  mints: readonly Pubkey[],
): Promise<Map<string, Partial<SocialLinks>>> {
  const found = new Map<string, Partial<SocialLinks>>();
  if (mints.length === 0) return found;

  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);

    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`,
        {cache: "no-store", signal: AbortSignal.timeout(8_000)},
      );
      if (!response.ok) {
        console.warn(`dexscreener socials -> ${response.status}`);
        continue;
      }

      const body = (await response.json()) as {pairs?: DexPair[] | null};

      for (const pair of body.pairs ?? []) {
        const mint = pair.baseToken?.address;
        if (!mint || found.has(mint)) continue;

        const links = socialsFrom(pair);
        // Only record a mint we actually learned something about, so the caller
        // can tell "no links" from "not asked".
        if (links.x || links.telegram || links.discord || links.website) {
          found.set(mint, links);
        }
      }
    } catch (error) {
      console.warn("dexscreener socials failed", (error as Error).message);
    }
  }

  return found;
}
