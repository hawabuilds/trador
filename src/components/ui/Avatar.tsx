"use client";

import {cn} from "@/lib/cn";

const GRADIENTS = [
  "linear-gradient(135deg,#6860FF,#524BD4)",
  "linear-gradient(135deg,#3DDBA8,#047857)",
  "linear-gradient(135deg,#FF6B7A,#DC2626)",
  "linear-gradient(135deg,#ABAEF5,#3F3999)",
  "linear-gradient(135deg,#8A85FF,#2D2866)",
  "linear-gradient(135deg,#F59E0B,#B8860B)",
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

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
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
