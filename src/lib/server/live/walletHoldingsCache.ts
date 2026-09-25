/**
 * Postgres-backed cache of raw wallet balances (mint → ui amount).
 *
 * The expensive part of a Stonkfolio read is three RPC calls listing every
 * token account. That result changes only when the wallet trades or receives
 * a transfer, while prices change constantly — so the cache holds balances,
 * not priced holdings. A hit still runs `universeFor` and live repricing.
 *
 * Best-effort writes; a miss or stale row falls through to RPC.
 */

import {lamportsFrom} from "@/lib/amounts";
import type {Pubkey} from "@/lib/pubkey";
import {useDirectPg, withClient} from "@/lib/server/adminPg";
import {db, hasDatabase} from "@/lib/server/db";

/** How long a cached balance map may skip RPC. */
export const HOLDINGS_CACHE_TTL_MS = 90_000;

/** When live RPC rate-limits, serve any row we have rather than erroring. */
export const HOLDINGS_STALE_FALLBACK_MS = Number.POSITIVE_INFINITY;

export interface CachedBalances {
  solLamports: number;
  byMint: Map<string, number>;
  refreshedAt: number;
}

export async function readCachedBalances(
  wallet: Pubkey,
  maxAgeMs = HOLDINGS_CACHE_TTL_MS,
): Promise<CachedBalances | null> {
  if (!useDirectPg && !hasDatabase) return null;

  try {
    if (useDirectPg) {
      return withClient(async (client) => {
        const {rows} = await client.query<{
          refreshed_at: Date | string;
          sol_lamports: string | number;
          balances: Record<string, number> | null;
        }>(
          `select refreshed_at, sol_lamports, balances
             from public.wallet_holdings_cache
            where wallet = $1`,
          [wallet],
        );
        const row = rows[0];
        if (!row) return null;
        const refreshedAt =
          row.refreshed_at instanceof Date
            ? row.refreshed_at.getTime()
            : Date.parse(row.refreshed_at);
        if (Date.now() - refreshedAt > maxAgeMs) return null;
        return {
          solLamports: lamportsFrom(row.sol_lamports) ?? 0,
          byMint: balancesToMap(row.balances),
          refreshedAt,
        };
      });
    }

    const {data, error} = await db()
      .from("wallet_holdings_cache")
      .select("refreshed_at,sol_lamports,balances")
      .eq("wallet", wallet)
      .maybeSingle();

    if (error) return null;
    if (!data) return null;
    const refreshedAt = Date.parse(data.refreshed_at as string);
    if (Date.now() - refreshedAt > maxAgeMs) return null;
    return {
      solLamports: lamportsFrom(data.sol_lamports) ?? 0,
      byMint: balancesToMap(data.balances as Record<string, number> | null),
      refreshedAt,
    };
  } catch {
    return null;
  }
}

export async function writeCachedBalances(
  wallet: Pubkey,
  solLamports: number,
  byMint: ReadonlyMap<string, number>,
): Promise<void> {
  if (!useDirectPg && !hasDatabase) return;
  const lamports = lamportsFrom(solLamports);
  if (lamports === null) return;

  const balances: Record<string, number> = {};
  for (const [mint, amount] of byMint) {
    if (typeof amount === "number" && amount > 0) balances[mint] = amount;
  }

  const refreshedAt = new Date().toISOString();

  try {
    if (useDirectPg) {
      await withClient((client) =>
        client.query(
          `insert into public.wallet_holdings_cache (wallet, refreshed_at, sol_lamports, balances)
           values ($1, $2, $3, $4)
           on conflict (wallet) do update
             set refreshed_at = excluded.refreshed_at,
                 sol_lamports = excluded.sol_lamports,
                 balances = excluded.balances`,
          [wallet, refreshedAt, lamports, balances],
        ),
      );
      return;
    }

    const {error} = await db().from("wallet_holdings_cache").upsert({
      wallet,
      refreshed_at: refreshedAt,
      sol_lamports: lamports,
      balances,
    });
    if (error) throw error;
  } catch (error) {
    console.error("wallet holdings cache write failed", error);
  }
}

function balancesToMap(raw: Record<string, number> | null): Map<string, number> {
  const byMint = new Map<string, number>();
  if (!raw || typeof raw !== "object") return byMint;
  for (const [mint, amount] of Object.entries(raw)) {
    if (typeof amount === "number" && amount > 0) byMint.set(mint, amount);
  }
  return byMint;
}
