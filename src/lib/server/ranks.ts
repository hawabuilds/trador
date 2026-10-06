/**
 * Rep, and the ranks it buys.
 *
 * Rep is written once per vote and never recomputed: the event carries the
 * points and what they were made of, so a season's table is a sum and a
 * disagreement about somebody's rank is settled by reading rows. Nothing here
 * updates a total in place, because a total that drifts has no record to be
 * put right from.
 *
 * Both drivers, like every other store read: direct Postgres for the worker
 * and scripts, PostgREST on Vercel.
 */

import {currentSeason, earnsRep, goatCount, rankFor, repForVote} from "@/lib/ranks";
import {DAILY_VOTE_CAP, type Rank, type RankId} from "@/config/ranks";
import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {boughtEarly} from "@/lib/holdingBand";
import {linksIn} from "@/lib/linkPreview";
import {useDirectPg, withClient} from "./adminPg";
import {db, hasDatabase} from "./db";
import {cached} from "./live/cache";

export const ranksReady = useDirectPg || hasDatabase;

export interface Standing {
  rep: number;
  /** 0 at the top of the table, 1 at the bottom. Null when nobody has rep. */
  percentile: number | null;
  rank: Rank;
}

interface TableRow {
  user_id: string;
  rep: number;
}

/**
 * The season's table, newest totals first.
 *
 * Read whole and cached for half a minute. It is one small aggregate, every
 * badge on a page of comments needs a place in it, and reading it per comment
 * would be a query per row for a number that barely moves.
 */
async function seasonTable(season: number): Promise<TableRow[]> {
  const {value} = await cached(`rep-table:${season}`, 30_000, async () => {
    if (useDirectPg) {
      return withClient(async (client) => {
        const {rows} = await client.query<{user_id: string; rep: string}>(
          `select user_id, rep from public.rep_totals
            where season = $1 and rep > 0 order by rep desc`,
          [season],
        );
        return rows.map((row) => ({user_id: row.user_id, rep: Number(row.rep)}));
      });
    }

    const {data, error} = await db()
      .from("rep_totals")
      .select("user_id, rep")
      .eq("season", season)
      .gt("rep", 0)
      .order("rep", {ascending: false});
    if (error) throw new Error(error.message);
    return ((data ?? []) as {user_id: string; rep: string | number}[]).map((row) => ({
      user_id: row.user_id,
      rep: Number(row.rep),
    }));
  });

  return value;
}

/** Everyone's standing, read from one copy of the table. */
export async function standingsFor(
  userIds: readonly string[],
  at: Date | string | number = Date.now(),
): Promise<Map<string, Standing>> {
  const found = new Map<string, Standing>();
  if (!ranksReady || userIds.length === 0) return found;

  const season = currentSeason(at);

  let table: TableRow[] = [];
  try {
    table = await seasonTable(season.id);
  } catch {
    // No table is not no ranks: everyone is an Intern, which is true.
  }

  const ranked = table.length;
  const goats = goatCount(ranked);
  const wanted = new Set(userIds);

  for (const [index, row] of table.entries()) {
    if (!wanted.has(row.user_id)) continue;
    // A place inside the top slice reads as being in it, so the last GOAT is
    // not excluded by a fraction either side of the line.
    const percentile = ranked === 0 ? null : index < goats ? 0 : (index + 1) / ranked;
    found.set(row.user_id, {
      rep: row.rep,
      percentile,
      rank: rankFor({rep: row.rep, percentile}),
    });
  }

  // Everyone with no rep this season holds the rank everyone starts at.
  for (const id of wanted) {
    if (!found.has(id)) {
      found.set(id, {rep: 0, percentile: null, rank: rankFor({rep: 0, percentile: null})});
    }
  }

  return found;
}

export async function standingFor(
  userId: string,
  at: Date | string | number = Date.now(),
): Promise<Standing> {
  return (
    (await standingsFor([userId], at)).get(userId) ?? {
      rep: 0,
      percentile: null,
      rank: rankFor({rep: 0, percentile: null}),
    }
  );
}

/* ---------------------------------------------------------------- earn --- */

/** Rep-earning votes this voter has already cast today, in UTC. */
async function earnedToday(voterId: string): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  if (useDirectPg) {
    return withClient(async (client) => {
      const {rows} = await client.query<{n: string}>(
        `select count(*) as n from public.rep_events
          where voter_id = $1 and created_at >= $2`,
        [voterId, since.toISOString()],
      );
      return Number(rows[0]?.n ?? 0);
    });
  }

  const {count, error} = await db()
    .from("rep_events")
    .select("id", {count: "exact", head: true})
    .eq("voter_id", voterId)
    .gte("created_at", since.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Whether the comment carries evidence, by the same rule the cards use.
 *
 * Strictly: a Solscan link counts only when the transaction or wallet involves
 * this coin's mint, and an X link only when the post actually resolved. A dead
 * link is not proof of anything, and the boost is the one place where saying
 * otherwise would be worth money.
 */
async function hasProof(body: string, mint: Pubkey | null): Promise<boolean> {
  const links = linksIn(body).filter(
    (link) => link.kind === "x" || link.kind === "solscan-tx" || link.kind === "solscan-account",
  );
  if (links.length === 0) return false;

  try {
    const {resolveCards} = await import("./live/linkCards");
    const cards = await resolveCards(links, mint);
    return cards.some((card) => card.proof);
  } catch {
    return false;
  }
}

/** Whether the author bought this coin before it tripled from the earliest price. */
async function wasEarly(wallet: Pubkey | null, mint: Pubkey | null): Promise<boolean> {
  if (!wallet || !mint) return false;

  try {
    const {earliestPriceFor, firstBuyPriceFor} = await import("./comments");
    const [earliest, firstBuy] = await Promise.all([
      earliestPriceFor(mint),
      firstBuyPriceFor(wallet, mint),
    ]);
    return boughtEarly({firstBuyPriceUsd: firstBuy, earliestPriceUsd: earliest});
  } catch {
    return false;
  }
}

export interface VoteSubject {
  commentId: string;
  authorId: string;
  authorWallet: string | null;
  mint: string | null;
  body: string;
}

/**
 * Record the rep a vote earns its author, if it earns any.
 *
 * Four things stop it, and none of them stop the vote itself — the count on
 * the comment still moves, because a like is a reader saying something was
 * useful whether or not they hold the coin:
 *
 *   1. The voter does not hold the coin.
 *   2. They have already earned on `DAILY_VOTE_CAP` votes today.
 *   3. There is no store to write to.
 *   4. They have already earned on this comment.
 *
 * Returns the rank the author ended on when it changed, so the caller can
 * record the rank-up. Never throws: a vote must not fail because rep could not
 * be worked out.
 */
export async function awardRep(
  voterId: string,
  subject: VoteSubject,
): Promise<{rankedUp: Rank | null}> {
  if (!ranksReady || voterId === subject.authorId) return {rankedUp: null};

  try {
    const mint = subject.mint ? asPubkey(subject.mint) : null;
    const voterWallet = await walletFor(voterId);
    if (!voterWallet || !mint) return {rankedUp: null};

    const {holdsAsset} = await import("./comments");
    if (!(await holdsAsset(voterWallet, mint))) return {rankedUp: null};

    if (!earnsRep(await earnedToday(voterId))) return {rankedUp: null};

    const season = currentSeason();
    const [voter, before] = await Promise.all([
      standingFor(voterId),
      standingFor(subject.authorId),
    ]);

    const [proof, early] = await Promise.all([
      hasProof(subject.body, mint),
      wasEarly(subject.authorWallet ? asPubkey(subject.authorWallet) : null, mint),
    ]);

    const points = repForVote({voterRank: voter.rank.id as RankId, proof, early});

    await insertRepEvent({
      season: season.id,
      voterId,
      commentId: subject.commentId,
      authorId: subject.authorId,
      points,
      voterWeight: voter.rank.weight,
      proof,
      early,
    });

    return {rankedUp: await rankedUpTo(subject.authorId, before.rank)};
  } catch (error) {
    console.error("awarding rep failed", error);
    return {rankedUp: null};
  }
}

/** Take back the rep a vote gave, when the vote is taken back. */
export async function removeRep(voterId: string, commentId: string): Promise<void> {
  if (!ranksReady) return;

  try {
    if (useDirectPg) {
      await withClient((client) =>
        client.query(
          `delete from public.rep_events where voter_id = $1 and comment_id = $2`,
          [voterId, commentId],
        ),
      );
    } else {
      await db().from("rep_events").delete().eq("voter_id", voterId).eq("comment_id", commentId);
    }
    forgetTable();
  } catch (error) {
    console.error("removing rep failed", error);
  }
}

async function insertRepEvent(input: {
  season: number;
  voterId: string;
  commentId: string;
  authorId: string;
  points: number;
  voterWeight: number;
  proof: boolean;
  early: boolean;
}): Promise<void> {
  if (useDirectPg) {
    await withClient((client) =>
      client.query(
        `insert into public.rep_events
           (season, voter_id, comment_id, author_id, points, voter_weight, proof_boost, early_boost)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (voter_id, comment_id) do nothing`,
        [
          input.season,
          input.voterId,
          input.commentId,
          input.authorId,
          input.points,
          input.voterWeight,
          input.proof,
          input.early,
        ],
      ),
    );
  } else {
    await db()
      .from("rep_events")
      .upsert(
        {
          season: input.season,
          voter_id: input.voterId,
          comment_id: input.commentId,
          author_id: input.authorId,
          points: input.points,
          voter_weight: input.voterWeight,
          proof_boost: input.proof,
          early_boost: input.early,
        },
        {onConflict: "voter_id,comment_id", ignoreDuplicates: true},
      );
  }

  forgetTable();
}

/** The table just moved, so the cached copy of it is wrong. */
function forgetTable(): void {
  void import("./live/cache").then(({invalidate}) => invalidate("rep-table:"));
}

/** The rank somebody has just reached, or null when they are where they were. */
async function rankedUpTo(userId: string, before: Rank): Promise<Rank | null> {
  const after = await standingFor(userId);
  if (after.rank.id === before.id) return null;

  // Only upwards. A season's table moves under everyone, and being passed is
  // not an event worth a screen.
  const order = ["intern", "analyst", "quant", "wolf", "goat"];
  return order.indexOf(after.rank.id) > order.indexOf(before.id) ? after.rank : null;
}

async function walletFor(userId: string): Promise<Pubkey | null> {
  const {walletOf} = await import("./social");
  const wallet = await walletOf(userId).catch(() => null);
  return wallet ? asPubkey(wallet) : null;
}

export {DAILY_VOTE_CAP};
