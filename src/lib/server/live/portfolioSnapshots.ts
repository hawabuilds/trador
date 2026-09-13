/**
 * What a wallet was worth, sampled over time.
 *
 * Nothing on chain records a wallet's past USD value, and reconstructing it
 * would mean replaying every transfer against historical prices for every token
 * — a different product, and still wrong for anything the price ladder cannot
 * reach back for. So the app samples: each read of a Stonkfolio writes at most
 * one row per interval, and the chart draws what was actually observed.
 *
 * The honest consequence is stated in the UI rather than hidden: **the line
 * starts when you first opened the app, not when you first bought.** Drawing it
 * back to zero would be a fabricated history, and a fabricated history on a
 * balance chart is the one lie a user cannot detect.
 *
 * Writes are best-effort throughout. A snapshot that fails must never fail the
 * Stonkfolio read it rode in on — the holdings are the product, the chart is
 * the decoration.
 */

import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {db, hasDatabase} from "@/lib/server/db";
import type {Pubkey} from "@/lib/pubkey";

/**
 * How often a wallet may add a point.
 *
 * The Stonkfolio refetches every 30 seconds while it is open, so without this
 * a tab left on a second monitor would write 2,880 rows a day and draw a chart
 * that is mostly noise. Ten minutes is fine enough to see a real move and
 * coarse enough that a day is 144 points.
 */
const MIN_GAP_MS = 10 * 60_000;

export interface Snapshot {
  /** Epoch milliseconds, matching `ChartPoint`. */
  t: number;
  value: number;
}

export const snapshotsReady = hasAdminPg || hasDatabase;

/**
 * Record a wallet's value, if enough time has passed since the last point.
 *
 * The gap is enforced by reading the newest row first rather than by an upsert
 * on a rounded timestamp. Rounding would make the interval a grid — two reads
 * either side of a boundary would both write — and the point here is spacing,
 * not alignment.
 */
export async function recordSnapshot(
  wallet: Pubkey,
  totalUsd: number,
  parts?: {stonksUsd?: number; stocksUsd?: number; solUsd?: number},
): Promise<void> {
  if (!snapshotsReady) return;
  // A wallet the RPC could not read comes back as 0, and writing that would
  // put a spike to zero in the middle of the chart.
  if (!Number.isFinite(totalUsd) || totalUsd < 0) return;

  try {
    const newest = await newestAt(wallet);
    if (newest !== null && Date.now() - newest < MIN_GAP_MS) return;

    await insert(wallet, totalUsd, parts);
  } catch (error) {
    // Best effort, by design. See the module note.
    console.error("portfolio snapshot failed", error);
  }
}

/** Points for the chart, oldest first. */
export async function readSnapshots(
  wallet: Pubkey,
  sinceMs: number,
): Promise<Snapshot[]> {
  if (!snapshotsReady) return [];

  const since = new Date(Date.now() - sinceMs).toISOString();

  try {
    if (hasAdminPg) {
      return withClient(async (client) => {
        const {rows} = await client.query(
          `select at, total_usd from public.portfolio_snapshots
            where wallet = $1 and at >= $2
            order by at asc`,
          [wallet, since],
        );
        return rows.map(toSnapshot);
      });
    }

    const {data, error} = await db()
      .from("portfolio_snapshots")
      .select("at,total_usd")
      .eq("wallet", wallet)
      .gte("at", since)
      .order("at", {ascending: true});

    if (error) throw new Error(error.message);
    return (data ?? []).map(toSnapshot);
  } catch (error) {
    console.error("portfolio history failed", error);
    return [];
  }
}

function toSnapshot(row: {at: string | Date; total_usd: string | number}): Snapshot {
  return {
    t: row.at instanceof Date ? row.at.getTime() : Date.parse(row.at),
    // Postgres `numeric` comes back as a string through both drivers, because
    // it is arbitrary precision and a float would not always round-trip. A
    // bare `+row.total_usd` here was what made the first chart render flat.
    value: Number(row.total_usd),
  };
}

async function newestAt(wallet: Pubkey): Promise<number | null> {
  if (hasAdminPg) {
    return withClient(async (client) => {
      const {rows} = await client.query(
        "select at from public.portfolio_snapshots where wallet = $1 order by at desc limit 1",
        [wallet],
      );
      if (!rows[0]) return null;
      const at = rows[0].at;
      return at instanceof Date ? at.getTime() : Date.parse(at);
    });
  }

  const {data, error} = await db()
    .from("portfolio_snapshots")
    .select("at")
    .eq("wallet", wallet)
    .order("at", {ascending: false})
    .limit(1);

  if (error) throw new Error(error.message);
  return data?.[0] ? Date.parse(data[0].at as string) : null;
}

async function insert(
  wallet: Pubkey,
  totalUsd: number,
  parts?: {stonksUsd?: number; stocksUsd?: number; solUsd?: number},
): Promise<void> {
  const row = {
    wallet,
    at: new Date().toISOString(),
    total_usd: totalUsd,
    stonks_usd: parts?.stonksUsd ?? null,
    stocks_usd: parts?.stocksUsd ?? null,
    sol_usd: parts?.solUsd ?? null,
  };

  if (hasAdminPg) {
    await withClient((client) =>
      client.query(
        `insert into public.portfolio_snapshots
           (wallet, at, total_usd, stonks_usd, stocks_usd, sol_usd)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (wallet, at) do nothing`,
        [row.wallet, row.at, row.total_usd, row.stonks_usd, row.stocks_usd, row.sol_usd],
      ),
    );
    return;
  }

  const {error} = await db().from("portfolio_snapshots").insert(row);
  if (error) throw new Error(error.message);
}
