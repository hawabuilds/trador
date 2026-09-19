/**
 * People, and who follows whom.
 *
 * Backed by the `users` and `follows` tables, both of which have existed since
 * the first migration and had nothing reading them. Two rules run through this
 * file:
 *
 *   1. **A profile is created from the token, never from the body.** `upsertMe`
 *      takes a caller id that `requireCaller` verified; the display name and
 *      bio a person sends only ever land on *their own* row.
 *   2. **A follow is a row, not a count.** Counts are derived on read rather
 *      than stored and incremented, because a stored counter drifts the first
 *      time a delete races an insert and there is no way to notice.
 */

import {hasAdminPg, withClient} from "@/lib/server/adminPg";
import {db, hasDatabase} from "@/lib/server/db";
import type {SocialLinks} from "@/lib/types";

export const socialReady = hasAdminPg || hasDatabase;

export interface Profile {
  id: string;
  handle: string;
  displayName: string;
  pfpUrl: string | null;
  bio: string | null;
  /** Null when the person keeps their Stonkfolio private, to everyone but themselves. */
  wallet: string | null;
  /** Whether their Stonkfolio shows on their profile. On unless they opted out. */
  portfolioPublic: boolean;
  followers: number;
  following: number;
  /** Whether the caller follows this person. Null when nobody is signed in. */
  isFollowing: boolean | null;
}

export interface ProfilePatch {
  handle?: string | null;
  displayName?: string | null;
  pfpUrl?: string | null;
  bio?: string | null;
  wallet?: string | null;
  socials?: Partial<SocialLinks> | null;
}

/**
 * Create or update the caller's own row.
 *
 * Called on sign-in so a person exists to be followed, and on save from the
 * edit sheet. `coalesce` on every optional column for the same reason the
 * indexer uses it: sign-in knows the handle and avatar but not the bio, and the
 * edit sheet knows the bio but may not send the avatar — without it the two
 * would take turns blanking each other.
 */
export async function upsertMe(userId: string, patch: ProfilePatch): Promise<void> {
  if (!socialReady) return;

  const handle = normalizeHandle(patch.handle);

  if (hasAdminPg) {
    await withClient((client) =>
      client.query(
        `insert into public.users (id, handle, display_name, pfp_url, bio, wallet)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update set
           handle       = coalesce(excluded.handle, public.users.handle),
           display_name = coalesce(excluded.display_name, public.users.display_name),
           pfp_url      = coalesce(excluded.pfp_url, public.users.pfp_url),
           bio          = coalesce(excluded.bio, public.users.bio),
           wallet       = coalesce(excluded.wallet, public.users.wallet),
           updated_at   = now()`,
        [
          userId,
          handle,
          patch.displayName ?? null,
          patch.pfpUrl ?? null,
          patch.bio ?? null,
          patch.wallet ?? null,
        ],
      ),
    );
    return;
  }

  await db()
    .from("users")
    .upsert(
      {
        id: userId,
        ...(handle ? {handle} : {}),
        ...(patch.displayName ? {display_name: patch.displayName} : {}),
        ...(patch.pfpUrl ? {pfp_url: patch.pfpUrl} : {}),
        ...(patch.bio !== undefined && patch.bio !== null ? {bio: patch.bio} : {}),
        ...(patch.wallet ? {wallet: patch.wallet} : {}),
      },
      {onConflict: "id"},
    );
}

/** Show or hide the caller's Stonkfolio on their profile. */
export async function setPortfolioPublic(userId: string, portfolioPublic: boolean): Promise<void> {
  if (!socialReady) return;
  await query(
    `update public.users set portfolio_public = $2, updated_at = now() where id = $1`,
    [userId, portfolioPublic],
  );
}

/** One profile by handle, with the caller's follow state resolved. */
export async function profileByHandle(
  handle: string,
  callerId: string | null,
): Promise<Profile | null> {
  if (!socialReady) return null;

  const key = normalizeHandle(handle);
  if (!key) return null;

  const rows = await query<RawProfile>(
    `select u.id, u.handle, u.display_name, u.pfp_url, u.bio, u.wallet, u.portfolio_public,
            (select count(*) from public.follows f where f.followee_id = u.id) as followers,
            (select count(*) from public.follows f where f.follower_id = u.id) as following,
            exists (
              select 1 from public.follows f
               where f.followee_id = u.id and f.follower_id = $2
            ) as is_following
       from public.users u
      where lower(u.handle) = $1
      limit 1`,
    [key, callerId ?? ""],
  );

  const row = rows[0];
  return row ? toProfile(row, callerId) : null;
}

/**
 * One profile by id.
 *
 * Separate from `profileByHandle` because the two keys are genuinely different
 * and confusing them is silent: a Privy DID passed to the handle lookup simply
 * matches nothing, so the caller gets `null` and carries on with a fallback
 * name. That is how a follow notification ends up reading "Someone followed
 * you" for every follower.
 */
export async function profileById(
  userId: string,
  callerId: string | null,
): Promise<Profile | null> {
  if (!socialReady || !userId) return null;

  const rows = await query<RawProfile>(
    `select u.id, u.handle, u.display_name, u.pfp_url, u.bio, u.wallet, u.portfolio_public,
            (select count(*) from public.follows f where f.followee_id = u.id) as followers,
            (select count(*) from public.follows f where f.follower_id = u.id) as following,
            exists (
              select 1 from public.follows f
               where f.followee_id = u.id and f.follower_id = $2
            ) as is_following
       from public.users u
      where u.id = $1
      limit 1`,
    [userId, callerId ?? ""],
  );

  const row = rows[0];
  return row ? toProfile(row, callerId) : null;
}

/** Everyone following this person. */
export async function followersOf(
  userId: string,
  callerId: string | null,
): Promise<Profile[]> {
  return people(
    `join public.follows f on f.follower_id = u.id
      where f.followee_id = $2`,
    callerId,
    [userId],
  );
}

/** Everyone this person follows. */
export async function followingOf(
  userId: string,
  callerId: string | null,
): Promise<Profile[]> {
  return people(
    `join public.follows f on f.followee_id = u.id
      where f.follower_id = $2`,
    callerId,
    [userId],
  );
}

/**
 * Follow or unfollow.
 *
 * `on conflict do nothing` rather than a read-then-write: following twice is
 * something a double tap does routinely, and it should be a no-op rather than a
 * unique violation surfaced as an error.
 */
export async function setFollow(
  callerId: string,
  targetHandle: string,
  wantFollow: boolean,
): Promise<{ok: boolean}> {
  if (!socialReady) return {ok: false};

  const key = normalizeHandle(targetHandle);
  if (!key) return {ok: false};

  const found = await query<{id: string}>(
    "select id from public.users where lower(handle) = $1 limit 1",
    [key],
  );
  const targetId = found[0]?.id;
  if (!targetId) return {ok: false};
  // The table has a `follows_not_self` check; refusing here turns what would be
  // a 500 from a constraint into an honest no-op.
  if (targetId === callerId) return {ok: false};

  if (wantFollow) {
    await query(
      `insert into public.follows (follower_id, followee_id)
       values ($1, $2) on conflict do nothing`,
      [callerId, targetId],
    );
  } else {
    await query(
      "delete from public.follows where follower_id = $1 and followee_id = $2",
      [callerId, targetId],
    );
  }

  return {ok: true};
}

// ---------------------------------------------------------------------------

interface RawProfile {
  id: string;
  handle: string | null;
  display_name: string | null;
  pfp_url: string | null;
  bio: string | null;
  wallet: string | null;
  portfolio_public: boolean | null;
  followers: string | number;
  following: string | number;
  is_following: boolean;
}

/**
 * A list of people, with follower counts and the caller's follow state.
 *
 * `$1` is the caller, which every query here references through `is_following`.
 * A clause supplies its own bindings from `$2` onward.
 *
 * **Every parameter must be referenced by the clause.** This used to pass the
 * subject as `$1` and let the search clause simply not mention it — which
 * Postgres rejects outright with "could not determine data type of parameter
 * $1", because an unused placeholder has no type to infer. The throw was caught
 * and turned into an empty list, so user search returned nobody, always, and
 * looked like an empty database rather than a broken query.
 */
async function people(
  clause: string,
  callerId: string | null,
  extra: unknown[] = [],
): Promise<Profile[]> {
  if (!socialReady) return [];

  const rows = await query<RawProfile>(
    `select u.id, u.handle, u.display_name, u.pfp_url, u.bio, u.wallet, u.portfolio_public,
            (select count(*) from public.follows x where x.followee_id = u.id) as followers,
            (select count(*) from public.follows x where x.follower_id = u.id) as following,
            exists (
              select 1 from public.follows x
               where x.followee_id = u.id and x.follower_id = $1
            ) as is_following
       from public.users u
       ${clause}
      order by u.handle
      limit 200`,
    [callerId ?? "", ...extra],
  );

  return rows.map((row) => toProfile(row, callerId));
}

function toProfile(row: RawProfile, callerId: string | null): Profile {
  return {
    id: row.id,
    handle: row.handle ?? "",
    displayName: row.display_name ?? row.handle ?? "Anonymous",
    pfpUrl: row.pfp_url,
    bio: row.bio,
    // A private Stonkfolio hides the wallet too — the address is the whole
    // portfolio to anyone with an explorer. Its owner still sees their own.
    wallet: row.portfolio_public === false && row.id !== callerId ? null : row.wallet,
    portfolioPublic: row.portfolio_public !== false,
    // `count(*)` is bigint, which both drivers hand back as a string because it
    // does not fit a JS number safely. `Number` here, not at the call site.
    followers: Number(row.followers),
    following: Number(row.following),
    isFollowing: callerId ? Boolean(row.is_following) : null,
  };
}

/**
 * One query path for both drivers.
 *
 * PostgREST cannot express the correlated subqueries these counts need, so the
 * Supabase path runs the same SQL through `rpc`-free raw access — which it does
 * not have. Rather than maintain two shapes that can silently disagree, this
 * requires the direct driver and reports honestly when it is absent.
 */
async function query<T>(sql: string, params: unknown[]): Promise<T[]> {
  if (!hasAdminPg) {
    throw new Error(
      "Accounts need a direct database connection. Set DATABASE_URL.",
    );
  }
  return withClient(async (client) => {
    const {rows} = await client.query(sql, params);
    return rows as T[];
  });
}

/** Handles are case-insensitive and stored without the leading `@`. */
function normalizeHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  // pubkey-lint-ok: a social handle, never an address.
  const cleaned = handle.replace(/^@/, "").trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * People, by handle or display name.
 *
 * Wildcards in the needle are escaped rather than passed through. `%` in a
 * LIKE pattern means "anything", so a search for `%` would otherwise return
 * every account in the database — which is not a crash, just a privacy leak
 * shaped like a feature.
 */
/**
 * A LIKE pattern that matches the text given, and nothing more.
 *
 * `%` and `_` are wildcards, so a search for `%` would otherwise return every
 * account in the database — not a crash, just a privacy leak shaped like a
 * feature. They are escaped with a backslash, which is the escape character
 * `ilike` uses by default.
 *
 * The previous version wrote the replacement as a template literal with an
 * escaped dollar sign, which produced the literal seven characters `${match}`
 * rather than a backslash and the matched wildcard.
 */
export function likePattern(needle: string): string {
  return `%${needle.replace(/[%_\\]/g, (match) => "\\" + match)}%`;
}

export async function searchPeople(
  needle: string,
  callerId: string | null,
  limit = 15,
): Promise<Profile[]> {
  if (!socialReady) return [];

  const trimmed = needle.trim().replace(/^@/, "");
  if (trimmed.length === 0) return [];

  const pattern = likePattern(trimmed);

  try {
    const found = await people(
      `where u.handle ilike $2 or u.display_name ilike $2`,
      callerId,
      [pattern],
    );
    return found.slice(0, limit);
  } catch (error) {
    console.error("people search failed", error);
    return [];
  }
}
