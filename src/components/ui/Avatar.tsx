"use client";

import {useState} from "react";

import {cn} from "@/lib/cn";

/**
 * Monogram backgrounds for rows with no artwork.
 *
 * **No green and no red in this set, deliberately.** The palette's rule is that
 * those two mean price direction and nothing else, and this was the last place
 * quietly breaking it: a coin whose seed happened to hash to the green gradient
 * wore a green disc directly beside its own price, which reads as a signal
 * about the coin. Two of these were literally the predecessor's `--price-up`
 * and `--price-down` values, carried over with the component.
 *
 * The rest were that app's brand violet. These are Trador's own — Solana purple
 * at the head, then five hues spaced far enough apart to tell apart at 32px,
 * all of them outside the green and red bands.
 */
const GRADIENTS = [
  "linear-gradient(135deg,#9945FF,#5D22A1)",
  "linear-gradient(135deg,#5B8DEF,#1E40AF)",
  "linear-gradient(135deg,#22D3EE,#0E7490)",
  "linear-gradient(135deg,#E879F9,#A21CAF)",
  "linear-gradient(135deg,#F5A524,#B4710C)",
  "linear-gradient(135deg,#8B93A7,#4A5060)",
];

/** Stable colour per seed, so avatars do not reshuffle between renders. */
export function gradientFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length];
}

interface AvatarProps {
  name?: string | null;
  /** Mint or other stable id — decides the colour. */
  seed?: string | null;
  /**
   * An image to show instead of the monogram, when one exists.
   *
   * Optional because most rows have none: coin art needs a fetch-resize-serve
   * pipeline before it can be trusted in a list, and a profile picture only
   * exists once someone has signed in.
   */
  src?: string | null;
  size?: number;
  className?: string;
}

/**
 * The mark on a feed row.
 *
 * No image pipeline yet: coin art comes from creator-supplied metadata that has
 * to be fetched, cached and resized before it can be trusted in a list, and a
 * half-built version of that means rows that flash, shift or blank out. A
 * seeded gradient and an initial are stable from the first paint, and the row
 * geometry is already correct for when artwork lands.
 */
export function Avatar({name, seed, src, size = 40, className}: AvatarProps) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  // Creator-hosted art goes away. Remember which URL failed so a dead link
  // falls back to the monogram instead of a broken-image glyph, while a new
  // URL still gets its own chance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && src !== failedSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setFailedSrc(src)}
        style={{width: size, height: size}}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: gradientFor(seed || name || "?"),
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-extrabold text-white",
        className,
      )}
    >
      <span style={{fontSize: Math.round(size * 0.4)}}>{initial}</span>
    </span>
  );
}
