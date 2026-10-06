/**
 * Whose trades the Following feed is allowed to show.
 *
 * Two conditions, both required: somebody follows them, and they have Public
 * portfolio on. The first keeps the watched set small — we track people who
 * are actually read, not every account — and the second is the promise made in
 * Settings. Turning that switch off takes someone out of this list on the next
 * pass, and their trades stop appearing in anyone's feed.
 */

import {asPubkey, type Pubkey} from "@/lib/pubkey";
import {useDirectPg, withClient} from "../adminPg";
import {db, hasDatabase} from "../db";

export interface FollowedWallet {
  userId: string;
  wallet: Pubkey;
}

/** Every wallet worth watching, newest follows first. Capped for the webhook. */
export async function followedPublicWallets(limit = 1_000): Promise<FollowedWallet[]> {
  if (useDirectPg) {
    const rows = await withClient(async (client) =>
      (
        await client.query<{id: string; wallet: string}>(
          `select distinct u.id, u.wallet
             from public.users u
             join public.follows f on f.followee_id = u.id
            where u.wallet is not null
              and u.portfolio_public is distinct from false
            limit $1`,
          [limit],
        )
      ).rows,
    );
    return rows.flatMap(toWallet);
  }

  if (!hasDatabase) return [];

  const {data: follows, error} = await db().from("follows").select("followee_id").limit(5_000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((follows ?? []).map((row) => String(row.followee_id)))];
  if (ids.length === 0) return [];

  const {data: users, error: usersError} = await db()
    .from("users")
    .select("id, wallet, portfolio_public")
    .in("id", ids)
    .not("wallet", "is", null)
    .limit(limit);
  if (usersError) throw new Error(usersError.message);

  return (users ?? [])
    .filter((user) => user.portfolio_public !== false)
    .flatMap((user) => toWallet({id: String(user.id), wallet: String(user.wallet)}));
}

function toWallet(row: {id: string; wallet: string}): FollowedWallet[] {
  const wallet = asPubkey(row.wallet);
  return wallet ? [{userId: row.id, wallet}] : [];
}
