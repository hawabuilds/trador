"use client";

import {RANKS, rankById, type RankId} from "@/config/ranks";
import {RankBadge} from "@/components/ui/RankBadge";
import {compact} from "@/lib/format";
import {currentSeason, nextRank} from "@/lib/ranks";

export interface StandingView {
  rank: RankId;
  rep: number;
  percentile: number | null;
}

/**
 * Where somebody stands this season.
 *
 * The rep and the climb, because a rank on its own tells you nothing about
 * what it took or what is next. GOAT shows the position instead of a target:
 * it is a slice of the table, not a number to reach, and promising "4,000 rep
 * to GOAT" would be a promise somebody else's rep can break.
 */
export function RankStanding({standing}: {standing: StandingView}) {
  const rank = rankById(standing.rank);
  const next = nextRank({rep: standing.rep, percentile: standing.percentile});
  const season = currentSeason();

  return (
    <div className="mt-4 flex items-center gap-4 rounded-2xl bg-surface-card px-4 py-4 shadow-card">
      <RankBadge rank={rank.id} size={64} />

      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold tracking-[-0.02em] text-ink">{rank.name}</p>
        <p className="tabular-nums mt-0.5 text-[13px] text-muted">
          {compact(standing.rep)} rep in {season.name}
        </p>
        <p className="mt-1 text-[13px] text-faint">
          {rank.id === "goat"
            ? "Top 1% this season"
            : next
              ? `${compact(next.repToGo)} rep to ${next.rank.name}`
              : `Top of ${RANKS[RANKS.length - 2].name}`}
        </p>
      </div>
    </div>
  );
}
