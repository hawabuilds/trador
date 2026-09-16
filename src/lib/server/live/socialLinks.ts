/**
 * Which slot a project link belongs in.
 *
 * Every source of links here — Jupiter's token metadata, DexScreener's pair
 * info, and whatever a creator typed into either — is the same kind of data:
 * a handful of URLs with a label the creator chose from a dropdown. The label
 * is unreliable in one specific, common way: people put their X profile in the
 * website slot, because that is the only account they have.
 *
 * Trusting the label stores `x.com/whatever` under `website`, so the coin
 * renders a globe icon and no X icon while plainly having an X account. Every
 * surface that looks for X — the token header, the share card — reads that as
 * "no socials".
 *
 * So the **host decides**, and the creator's label is only consulted when the
 * host is not one we recognise. This is HODL's rule from `tokenSocials.ts`,
 * kept because the failure it prevents is silent on both sides: nothing throws,
 * the link still works, it is just filed under the wrong icon.
 */

import type {SocialLinks} from "@/lib/types";

/** A link, or nothing. */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    // Creator-supplied metadata is the one field an attacker fully controls,
    // so anything that is not plain http(s) is dropped rather than cleaned up.
    // `javascript:` in an `href` is the whole reason this is not a bare string.
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** The slot this URL's host earns, or null if the host says nothing. */
export function classifyUrl(url: string): keyof SocialLinks | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  if (host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com")) {
    return "x";
  }
  if (host === "t.me" || host === "telegram.me" || host === "telegram.org") {
    return "telegram";
  }
  if (
    host === "discord.gg" ||
    host === "discord.com" ||
    host === "discordapp.com" ||
    host.endsWith(".discord.com")
  ) {
    return "discord";
  }
  return null;
}

/** The creator's own label, when the host said nothing. */
export function labelKind(type: string | undefined | null): keyof SocialLinks | null {
  const value = type?.toLowerCase();
  // DexScreener labels the same field `twitter` on older pairs and `x` on newer
  // ones, so both map to the same slot.
  if (value === "twitter" || value === "x") return "x";
  if (value === "telegram" || value === "tg") return "telegram";
  if (value === "discord") return "discord";
  if (value === "website" || value === "web" || value === "site") return "website";
  return null;
}

/**
 * Collect URLs into slots, host first.
 *
 * First write wins per slot: two X links means the creator entered two, and
 * there is no signal here for which is current. Anything unrecognised falls
 * through to `website`, which is what a project homepage is.
 */
export function collectLinks(
  entries: readonly {url: unknown; type?: string | null}[],
): Partial<SocialLinks> {
  const found: Partial<SocialLinks> = {};

  for (const entry of entries) {
    const url = httpUrl(entry.url);
    if (!url) continue;
    const slot = classifyUrl(url) ?? labelKind(entry.type) ?? "website";
    if (!found[slot]) found[slot] = url;
  }

  return found;
}
