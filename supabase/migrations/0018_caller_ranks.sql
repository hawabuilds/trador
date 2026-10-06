-- Caller ranks: rep earned from votes, and the rows the notifications list and
-- the Stonkfolio were missing.
--
-- Additive only. Nothing here is renamed, dropped or rewritten, every new
-- column is nullable with no default, and nothing the live app reads changes.
--
-- Rep is stored as events rather than as a total. A total is a number that can
-- be wrong in a way nobody can see: an unvote that fails to decrement leaves a
-- player ahead forever, and there is no record to put it right from. Events
-- carry what each vote was made of, so the season can be re-summed from them
-- and a disagreement about somebody's rank can be settled by reading.

create table if not exists public.rep_events (
  id           bigserial    primary key,
  season       smallint     not null,
  voter_id     text         not null references public.users (id) on delete cascade,
  comment_id   bigint       not null references public.comments (id) on delete cascade,
  author_id    text         not null references public.users (id) on delete cascade,
  -- Halves are real: a GOAT's vote on an early call with proof is 37.5.
  points       numeric(8,2) not null,
  -- What the points were made of, kept so a total can always be explained and
  -- so changing the rules later cannot silently rewrite rep already earned.
  voter_weight numeric(4,2) not null,
  proof_boost  boolean      not null default false,
  early_boost  boolean      not null default false,
  created_at   timestamptz  not null default now(),
  -- One rep event per vote, matching the one like per person per comment that
  -- `comment_likes` already enforces.
  unique (voter_id, comment_id)
);

-- A season's table, and the daily cap, are the two reads this table is for.
create index if not exists rep_events_author_season on public.rep_events (author_id, season);
create index if not exists rep_events_voter_day on public.rep_events (voter_id, created_at desc);

alter table public.rep_events enable row level security;

-- Totals summed from the events rather than stored beside them, so the two can
-- never disagree and removing a vote takes its rep back without a second write.
create or replace view public.rep_totals with (security_invoker = true) as
  select author_id as user_id,
         season,
         sum(points)::numeric(12,2) as rep,
         count(*)::int              as votes
    from public.rep_events
   group by author_id, season;

-- `security_invoker` makes the view obey the caller's row security instead of
-- its owner's, and the revoke means the anon and signed-in keys cannot read it
-- at all. Same posture as the tables underneath: the service role only.
revoke all on public.rep_totals from anon, authenticated;

-- Price moves and rank-ups, kept whether or not a push went out.
--
-- `notification_events` cannot do this job: it is the push ledger, and a claim
-- is deleted again when nobody has a device subscribed, so somebody who never
-- turned push on has no history at all.
create table if not exists public.inbox_events (
  id         bigserial   primary key,
  user_id    text        not null references public.users (id) on delete cascade,
  kind       text        not null,
  subject    text        not null,
  rung       integer     not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, kind, subject, rung)
);

create index if not exists inbox_events_user_at on public.inbox_events (user_id, created_at desc);

alter table public.inbox_events enable row level security;

-- When this person last opened the notifications list, so a phone and a laptop
-- agree about what is new.
alter table public.users add column if not exists notifications_seen_at timestamptz;

-- The Useful votes switch. Nullable with no default: the prefs reader already
-- treats a missing value as on, so no existing row needs touching.
alter table public.notification_prefs add column if not exists social_vote boolean;

-- What the coin was worth when the trade happened. Null for every trade already
-- stored, because it was never recorded and cannot honestly be filled in now.
alter table public.wallet_trades add column if not exists market_cap_usd numeric;
