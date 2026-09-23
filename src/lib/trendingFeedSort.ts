import type {Pubkey} from "@/lib/pubkey";
import type {Stonk} from "@/lib/types";

/** Descending with nulls last — matches `listStonks` trending order. */
export function compareDescNullsLast(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  const aFinite = a !== null && a !== undefined && Number.isFinite(a);
  const bFinite = b !== null && b !== undefined && Number.isFinite(b);
  if (aFinite && bFinite) return b - a;
  if (aFinite !== bFinite) return aFinite ? -1 : 1;
  return 0;
}

/** Byte order for mint tiebreak — matches Postgres `COLLATE "C"` / `mint desc`. */
export function compareMintDesc(a: Pubkey, b: Pubkey): number {
  return b < a ? -1 : b > a ? 1 : 0;
}

/**
 * Client and snapshot fallback for Trending — never price or market cap.
 *
 * Primary: `trendingScore`, then `volume24hUsd`, then mint descending.
 */
export function compareTrendingStonks(a: Stonk, b: Stonk): number {
  const byScore = compareDescNullsLast(a.trendingScore, b.trendingScore);
  if (byScore !== 0) return byScore;

  const byVol = compareDescNullsLast(a.volume24hUsd, b.volume24hUsd);
  if (byVol !== 0) return byVol;

  return compareMintDesc(a.mint, b.mint);
}

export function sortStonksTrending<T extends Stonk>(items: readonly T[]): T[] {
  return [...items].sort(compareTrendingStonks);
}

export interface TrendingCursor {
  score: number | null;
  vol: number | null;
  mint: string;
}

function parseCursorField(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** `score|vol|mint` — empty fields mean SQL null. Legacy `score|mint` still parses. */
export function parseTrendingCursor(cursor: string): TrendingCursor {
  const mintSep = cursor.lastIndexOf("|");
  if (mintSep < 0) return {score: null, vol: null, mint: ""};

  const mint = cursor.slice(mintSep + 1);
  const rest = cursor.slice(0, mintSep);
  const volSep = rest.lastIndexOf("|");
  if (volSep < 0) {
    return {score: parseCursorField(rest), vol: null, mint};
  }

  return {
    score: parseCursorField(rest.slice(0, volSep)),
    vol: parseCursorField(rest.slice(volSep + 1)),
    mint,
  };
}

export function encodeTrendingCursor(parts: TrendingCursor): string {
  const score = parts.score ?? "";
  const vol = parts.vol ?? "";
  return `${score}|${vol}|${parts.mint}`;
}

/**
 * PostgREST keyset filter for trending order:
 * `trending_score desc nulls last, vol_24h desc nulls last, mint desc`.
 */
export function trendingCursorFilter(cursor: TrendingCursor): string | null {
  const {score, vol, mint} = cursor;
  if (!mint) return null;

  // Legacy two-part cursor — score + mint only.
  if (vol === null && score !== null) {
    return `trending_score.lt.${score},and(trending_score.eq.${score},mint.lt.${mint})`;
  }

  if (score === null) {
    if (vol === null) {
      return `and(trending_score.is.null,vol_24h.is.null,mint.lt.${mint})`;
    }
    return `and(trending_score.is.null,or(vol_24h.lt.${vol},and(vol_24h.eq.${vol},mint.lt.${mint})))`;
  }

  if (vol === null) {
    return `trending_score.lt.${score},and(trending_score.eq.${score},vol_24h.is.null,mint.lt.${mint})`;
  }

  return `trending_score.lt.${score},and(trending_score.eq.${score},vol_24h.lt.${vol}),and(trending_score.eq.${score},vol_24h.eq.${vol},mint.lt.${mint})`;
}
