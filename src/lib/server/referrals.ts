/**
 * Referral tracking: who shared a link, who opened it, who signed up through it.
 *
 * A person's shared profile link is their referral link. Opens are recorded
 * here; sign-ups are attributed in `upsertMe`, at the one moment an account is
 * new. Everything is visible to the admin only — users share, they do not see
 * the numbers.
 *
 * Admin is a Privy DID in `ADMIN_USER_IDS`, never a handle: the handle on a
 * profile row arrives in a request body, while the DID comes from a verified
 * token, and only one of those is proof of who is asking.
 */

import {hasAdminPg, withClient} from "@/lib/server/adminPg";

const ADMINS = new Set(
  (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

export function isAdmin(userId: string | null | undefined): boolean {
  return Boolean(userId && ADMINS.has(userId));
}

const HANDLE = /^[A-Za-z0-9_]{1,30}$/;
const VISITOR = /^[A-Za-z0-9-]{8,64}$/;

/**
 * One open of someone's link. Counted once per visitor per referrer, so a
 * reload or a second tap does not inflate the number. A handle nobody has is
 * silently ignored.
 */
export async function recordVisit(handle: string, visitor: string): Promise<boolean> {
  if (!hasAdminPg || !HANDLE.test(handle) || !VISITOR.test(visitor)) return false;
  const result = await withClient((client) =>
    client.query(
      `insert into public.referral_visits (referrer_id, visitor)
       select u.id, $2 from public.users u where lower(u.handle) = lower($1) limit 1
       on conflict do nothing`,
      [handle, visitor],
    ),
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ReferredUser {
  id: string;
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  joinedAt: string;
  /** Has made at least one trade from their wallet. */
  traded: boolean;
}

export interface Referrer {
  id: string;
  handle: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  opens: number;
  signUps: number;
  /** Of those sign-ups, how many have traded. */
  traded: number;
  lastSignUpAt: string | null;
  referred: ReferredUser[];
}

export interface ReferralReport {
  totals: {opens: number; signUps: number; traded: number; referrers: number};
  referrers: Referrer[];
}

/** Everything, for the admin page: totals, then every referrer ranked by sign-ups. */
export async function referralReport(): Promise<ReferralReport> {
  if (!hasAdminPg) {
    return {totals: {opens: 0, signUps: 0, traded: 0, referrers: 0}, referrers: []};
  }

  return withClient(async (client) => {
    const referred = await client.query<{
      id: string;
      handle: string | null;
      display_name: string | null;
      pfp_url: string | null;
      referred_by: string;
      referred_at: string;
      traded: boolean;
    }>(
      `select u.id, u.handle, u.display_name, u.pfp_url, u.referred_by, u.referred_at,
              exists (select 1 from public.wallet_trades t where t.wallet = u.wallet) as traded
         from public.users u
        where u.referred_by is not null
        order by u.referred_at desc`,
    );

    const opens = await client.query<{referrer_id: string; opens: string}>(
      `select referrer_id, count(*) as opens from public.referral_visits group by referrer_id`,
    );

    const ids = [
      ...new Set([...referred.rows.map((row) => row.referred_by), ...opens.rows.map((row) => row.referrer_id)]),
    ];
    const people = ids.length
      ? await client.query<{id: string; handle: string | null; display_name: string | null; pfp_url: string | null}>(
          `select id, handle, display_name, pfp_url from public.users where id = any($1::text[])`,
          [ids],
        )
      : {rows: []};

    const opensBy = new Map(opens.rows.map((row) => [row.referrer_id, Number(row.opens)]));
    const referrers = people.rows.map((person): Referrer => {
      const mine = referred.rows.filter((row) => row.referred_by === person.id);
      return {
        id: person.id,
        handle: person.handle,
        displayName: person.display_name,
        pfpUrl: person.pfp_url,
        opens: opensBy.get(person.id) ?? 0,
        signUps: mine.length,
        traded: mine.filter((row) => row.traded).length,
        lastSignUpAt: mine[0]?.referred_at ? new Date(mine[0].referred_at).toISOString() : null,
        referred: mine.map((row) => ({
          id: row.id,
          handle: row.handle,
          displayName: row.display_name,
          pfpUrl: row.pfp_url,
          joinedAt: new Date(row.referred_at).toISOString(),
          traded: row.traded,
        })),
      };
    });

    referrers.sort((a, b) => b.signUps - a.signUps || b.opens - a.opens);

    return {
      totals: {
        opens: [...opensBy.values()].reduce((sum, value) => sum + value, 0),
        signUps: referred.rows.length,
        traded: referred.rows.filter((row) => row.traded).length,
        referrers: referrers.filter((entry) => entry.signUps > 0).length,
      },
      referrers,
    };
  });
}
