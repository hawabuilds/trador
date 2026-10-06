/**
 * What a vote is worth, and what a rank is.
 *
 * Pure, and the only place either is decided. Rep is the app's one number that
 * people will argue about, so the arithmetic lives apart from the store that
 * records it and the screens that show it, where it can be read and tested on
 * its own.
 */

import {
  DAILY_VOTE_CAP,
  EARLY_BOOST,
  GOAT_PERCENTILE,
  PROOF_BOOST,
  RANKS,
  SEASONS,
  VOTE_POINTS,
  type Rank,
  type RankId,
  type Season,
} from "@/config/ranks";

export interface VoteFacts {
  /** The rank of the person voting, which is what their vote is multiplied by. */
  voterRank: RankId;
  /** The comment carries an X or Solscan link that checked out. */
  proof: boolean;
  /** The author bought this coin early. */
  early: boolean;
}

/**
 * Rep one vote earns the author.
 *
 * Halves are real: a GOAT's vote on an early call with proof is 37.5, and an
 * Intern's on a comment with proof is 12.5. Rounded to two places so the sum
 * of a season cannot drift on floating point.
 */
export function repForVote(facts: VoteFacts): number {
  const weight = RANKS.find((rank) => rank.id === facts.voterRank)?.weight ?? 1;
  const points =
    VOTE_POINTS * weight * (facts.proof ? PROOF_BOOST : 1) * (facts.early ? EARLY_BOOST : 1);
  return Math.round(points * 100) / 100;
}

/** Whether this vote still earns, given how many the voter has earned today. */
export function earnsRep(votesEarnedToday: number): boolean {
  return votesEarnedToday < DAILY_VOTE_CAP;
}

export interface Standing {
  /** Rep this season. */
  rep: number;
  /**
   * Where they sit among everyone with any rep this season, as a fraction:
   * 0 is the top of the table, 1 the bottom. Null when nobody has rep yet.
   */
  percentile: number | null;
}

/**
 * The rank somebody holds.
 *
 * GOAT needs both the slice and the rep. A season with nine players would
 * otherwise hand the top one a GOAT badge for a single upvote, which is the
 * fastest way to make the whole ladder mean nothing.
 */
export function rankFor(standing: Standing): Rank {
  const goat = RANKS[RANKS.length - 1];
  if (
    standing.rep >= goat.rep &&
    standing.percentile !== null &&
    standing.percentile <= GOAT_PERCENTILE
  ) {
    return goat;
  }

  let held = RANKS[0];
  for (const rank of RANKS) {
    if (rank.id === "goat") continue;
    if (standing.rep >= rank.rep) held = rank;
  }
  return held;
}

/**
 * The next rung and the rep still to climb, or null at the top.
 *
 * GOAT is never named here. It is not a number anyone can work towards —
 * "320 rep to GOAT" would be a promise the standings can break by somebody
 * else earning rep.
 */
export function nextRank(standing: Standing): {rank: Rank; repToGo: number} | null {
  const held = rankFor(standing);
  if (held.id === "goat") return null;

  const climbing = RANKS.filter((rank) => rank.id !== "goat");
  const next = climbing.find((rank) => rank.rep > standing.rep);
  if (!next) return null;

  return {rank: next, repToGo: Math.ceil(next.rep - standing.rep)};
}

/**
 * How many people make the top slice.
 *
 * At least one, so a season with a handful of players still has a place at the
 * top rather than rounding it away.
 */
export function goatCount(ranked: number): number {
  if (ranked <= 0) return 0;
  return Math.max(1, Math.floor(ranked * GOAT_PERCENTILE));
}

/** The season a moment belongs to, or null outside every season. */
export function seasonAt(at: Date | string | number = Date.now()): Season | null {
  const ms = new Date(at).getTime();
  return (
    SEASONS.find(
      (season) => ms >= Date.parse(season.startsAt) && ms < Date.parse(season.endsAt),
    ) ?? null
  );
}

/** The season being played now, or the last one that ran. */
export function currentSeason(at: Date | string | number = Date.now()): Season {
  return seasonAt(at) ?? SEASONS[SEASONS.length - 1];
}
