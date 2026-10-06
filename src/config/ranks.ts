/**
 * Caller ranks, in one place so the numbers can be changed without hunting.
 *
 * Everything here is a rule somebody can argue about — what a vote is worth,
 * what makes a Quant, when the season ends — so none of it is written into the
 * code that applies it.
 */

export type RankId = "intern" | "analyst" | "quant" | "wolf" | "goat";

export interface Rank {
  id: RankId;
  name: string;
  /** Rep needed to reach it. GOAT also needs the percentile below. */
  rep: number;
  /** What a vote from someone of this rank is multiplied by. */
  weight: number;
  /** The line on the rank-up screen. Empty for the rank everyone starts at. */
  line: string;
}

/** In order, lowest first. The list is the ladder. */
export const RANKS: readonly Rank[] = [
  {id: "intern", name: "Intern", rep: 0, weight: 1, line: ""},
  {id: "analyst", name: "Analyst", rep: 250, weight: 1.25, line: "You read the charts now"},
  {id: "quant", name: "Quant", rep: 1_000, weight: 1.5, line: "Galaxy brain calls"},
  {id: "wolf", name: "Wolf", rep: 5_000, weight: 1.75, line: "Wolf of Wall Street energy"},
  {
    id: "goat",
    name: "GOAT",
    rep: 5_000,
    weight: 2,
    line: "Top 1% of callers this season",
  },
] as const;

/** Base rep one vote is worth, before the voter's weight and the boosts. */
export const VOTE_POINTS = 10;

/** A comment carrying an X or Solscan link that actually checks out. */
export const PROOF_BOOST = 1.25;

/** The author bought under 3x the earliest price we hold for that coin. */
export const EARLY_BOOST = 1.5;

/**
 * Votes a person can earn rep with per day.
 *
 * Past this their votes still count on the comment — the number goes up, the
 * author sees it — but they stop moving rep. Without a cap, rep measures how
 * much time somebody spends tapping rather than whether their calls were good.
 */
export const DAILY_VOTE_CAP = 20;

/**
 * GOAT is the top slice of the season, floored at Wolf's rep.
 *
 * Both conditions, because either alone is wrong: a percentile on its own
 * crowns whoever shows up first in a quiet season, and a threshold on its own
 * makes GOAT a rank rather than a position.
 */
export const GOAT_PERCENTILE = 0.01;

export interface Season {
  id: number;
  name: string;
  /** Inclusive start, exclusive end, both UTC. */
  startsAt: string;
  endsAt: string;
}

export const SEASONS: readonly Season[] = [
  {
    id: 1,
    name: "Season 1",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-11-01T00:00:00.000Z",
  },
] as const;

export const rankById = (id: RankId): Rank =>
  RANKS.find((rank) => rank.id === id) ?? RANKS[0];
