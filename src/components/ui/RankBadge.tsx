import {rankById, type RankId} from "@/config/ranks";

/**
 * The glow, per rank, at the size it was drawn for.
 *
 * Only the top three have one. A badge that glows is a badge somebody worked
 * for, and giving the starting rank the same treatment would say nothing.
 */
const GLOW: Partial<Record<RankId, {blur: number; colour: string}>> = {
  quant: {blur: 8, colour: "rgba(153,69,255,.45)"},
  wolf: {blur: 10, colour: "rgba(153,69,255,.65)"},
  goat: {blur: 12, colour: "rgba(181,122,255,.9)"},
};

/** The size the glow radii above were chosen at. */
const DRAWN_AT = 64;

/**
 * A rank badge.
 *
 * The blur scales with the badge. A 12px halo around a 20px badge beside a
 * username is a purple smudge, not a glow — at that size it bleeds into the
 * text before anyone can tell what the picture is.
 */
export function RankBadge({
  rank,
  size = 20,
  className,
}: {
  rank: RankId;
  size?: number;
  className?: string;
}) {
  const glow = GLOW[rank];
  const blur = glow ? Math.max(2, (glow.blur * size) / DRAWN_AT) : 0;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/ranks/${rank}.svg`}
      alt={rankById(rank).name}
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        filter: glow ? `drop-shadow(0 0 ${blur.toFixed(1)}px ${glow.colour})` : undefined,
      }}
    />
  );
}

/** The badge and the rank's name, which is how it reads beside a username. */
export function RankTag({rank, size = 20}: {rank: RankId; size?: number}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <RankBadge rank={rank} size={size} />
      <span className="text-[13px] font-medium text-muted">{rankById(rank).name}</span>
    </span>
  );
}
