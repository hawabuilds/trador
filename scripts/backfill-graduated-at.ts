/**
 * Pull `graduated_at` back to the trading pair's open time.
 *
 * A gap-fill that discovers already-graduated pools stamps `graduated_at = now`,
 * so every recovered coin shares one indexer-write clock and New shows them all
 * as minutes old. LaunchLab pool state has no graduation timestamp; DexScreener's
 * `pairCreatedAt` on the deepest Raydium pair is the CPMM open time — the real
 * graduation for curve launches.
 *
 * Prefer direct Postgres (`DATABASE_URL` / Railway pooler). PostgREST is the
 * fallback when only service-role credentials are available.
 *
 *   npm run backfill:graduated-at
 *   railway run --service trador-indexer npm run backfill:graduated-at
 *
 * Safe to re-run: only writes when Dex's open time is earlier than stored.
 */

import {dexscreenerFill} from "@/lib/server/live/dexscreener";
import {hasAdminPg, pgUpdateStonks, withClient} from "@/lib/server/adminPg";
import {db, hasDatabase} from "@/lib/server/db";
import type {Pubkey} from "@/lib/pubkey";
import type {StonkWrite} from "@/lib/server/live/universeStore";

/** Gap-fill cluster from 2026-09-24. */
const FORCE_STAMP_START = "2026-09-24T19:15:26.000Z";
const FORCE_STAMP_END = "2026-09-24T19:15:27.000Z";

type Row = {mint: string; symbol: string | null; graduated_at: string};

async function applyWrites(writes: StonkWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  if (hasAdminPg) return pgUpdateStonks(writes);

  let updated = 0;
  for (const write of writes) {
    if (!write.graduated_at) continue;
    const {error} = await db()
      .from("stonks")
      .update({graduated_at: write.graduated_at, updated_at: new Date().toISOString()})
      .eq("mint", write.mint)
      .gt("graduated_at", write.graduated_at);
    if (!error) updated += 1;
  }
  return updated;
}

async function listedNeedingCorrection(): Promise<Row[]> {
  const since = new Date(Date.now() - 48 * 60 * 60_000).toISOString();

  if (hasAdminPg) {
    return withClient(async (client) => {
      const result = await client.query<Row>(
        `select mint, symbol, graduated_at::text as graduated_at
         from public.stonks
         where status = 'listed'
           and graduated_at is not null
           and graduated_at > $1::timestamptz
         order by graduated_at desc, mint desc
         limit 500`,
        [since],
      );
      return result.rows;
    });
  }

  if (!hasDatabase) return [];

  const {data, error} = await db()
    .from("stonks")
    .select("mint, symbol, graduated_at")
    .eq("status", "listed")
    .not("graduated_at", "is", null)
    .gt("graduated_at", since)
    .order("graduated_at", {ascending: false})
    .order("mint", {ascending: false})
    .limit(500);

  if (error) throw new Error(`List failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    mint: row.mint as string,
    symbol: (row.symbol as string | null) ?? null,
    graduated_at: String(row.graduated_at),
  }));
}

async function listedWithForceStamp(): Promise<Row[]> {
  if (hasAdminPg) {
    return withClient(async (client) => {
      const result = await client.query<Row>(
        `select mint, symbol, graduated_at::text as graduated_at
         from public.stonks
         where status = 'listed'
           and graduated_at >= $1::timestamptz
           and graduated_at < $2::timestamptz
         order by symbol nulls last, mint`,
        [FORCE_STAMP_START, FORCE_STAMP_END],
      );
      return result.rows;
    });
  }

  if (!hasDatabase) {
    throw new Error(
      "No database. Set DATABASE_URL (pooler), or PostgREST service-role credentials.",
    );
  }

  const {data, error} = await db()
    .from("stonks")
    .select("mint, symbol, graduated_at")
    .eq("status", "listed")
    .gte("graduated_at", FORCE_STAMP_START)
    .lt("graduated_at", FORCE_STAMP_END)
    .order("mint", {ascending: true})
    .limit(500);

  if (error) throw new Error(`List failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    mint: row.mint as string,
    symbol: (row.symbol as string | null) ?? null,
    graduated_at: String(row.graduated_at),
  }));
}

async function correctRows(rows: Row[]): Promise<{updated: number; examples: {symbol: string; from: string; to: string}[]}> {
  if (rows.length === 0) return {updated: 0, examples: []};

  const fills = await dexscreenerFill(rows.map((row) => row.mint as Pubkey));
  const writes: StonkWrite[] = [];
  const examples: {symbol: string; from: string; to: string}[] = [];

  for (const row of rows) {
    const fill = fills.get(row.mint);
    if (!fill?.pairCreatedAt) continue;
    const next = Date.parse(fill.pairCreatedAt);
    const prev = Date.parse(row.graduated_at);
    if (!Number.isFinite(next) || !Number.isFinite(prev)) continue;
    if (next >= prev) continue;

    writes.push({mint: row.mint, graduated_at: fill.pairCreatedAt});
    if (examples.length < 12) {
      examples.push({
        symbol: row.symbol ?? row.mint.slice(0, 8),
        from: row.graduated_at,
        to: fill.pairCreatedAt,
      });
    }
  }

  const updated = await applyWrites(writes);
  return {updated, examples};
}

async function main(): Promise<void> {
  console.log(
    hasAdminPg
      ? "Using direct Postgres (DATABASE_URL)."
      : "Using PostgREST (no DATABASE_URL).",
  );

  // Force-stamp cluster first, with a couple of Dex retries — a single batch
  // can miss pairs under rate limit and leave coins looking minutes old.
  let totalUpdated = 0;
  for (let round = 1; round <= 3; round += 1) {
    const forced = await listedWithForceStamp();
    console.log(`Round ${round}: ${forced.length} coin(s) still on the gap-fill stamp.`);
    if (forced.length === 0) break;
    const {updated, examples} = await correctRows(forced);
    totalUpdated += updated;
    for (const ex of examples) {
      console.log(`  ${ex.symbol.padEnd(14)} ${ex.from} → ${ex.to}`);
    }
    if (updated === 0) break;
  }

  // Also pull any other recent provisional stamps earlier when Dex knows more.
  const recent = await listedNeedingCorrection();
  const {updated, examples} = await correctRows(recent);
  totalUpdated += updated;
  if (examples.length > 0) {
    console.log(`Also corrected ${updated} recent coin(s):`);
    for (const ex of examples) {
      console.log(`  ${ex.symbol.padEnd(14)} ${ex.from} → ${ex.to}`);
    }
  }

  const left = (await listedWithForceStamp()).length;
  console.log(`\nDone. Updated ${totalUpdated} row(s). Still on gap-fill stamp: ${left}.\n`);
}

main().catch((error) => {
  console.error((error as Error).message.replace(/https?:\/\/\S+/g, "[url]"));
  process.exit(1);
});
