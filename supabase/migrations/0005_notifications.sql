-- Notifications.
--
-- Three tables, and the third is the one that matters. A notification system
-- without a ledger re-sends on every pass: the indexer is a reconciler, so it
-- recomputes the same world every ninety seconds, and "this coin is up 5x" is
-- true on all of them. `notification_events` is what turns a standing fact into
-- a single message.

/*
 * What someone wants to hear about.
 *
 * Defaults chosen so the first notification a person receives is one they would
 * have wanted: follows and replies on, holdings milestones on, watchlist
 * milestones off. A watchlist is a browsing tool — people star twenty coins and
 * would be notified about all of them — while holdings are money.
 */
create table if not exists public.notification_prefs (
  user_id            text primary key references public.users (id) on delete cascade,

  -- One switch above all others, so "make it stop" is a single tap.
  muted              boolean not null default false,

  social_follow      boolean not null default true,
  social_reply       boolean not null default true,

  holdings_on        boolean not null default true,
  holdings_multiples integer[] not null default '{2,5,10}',

  watchlist_on       boolean not null default false,
  watchlist_multiples integer[] not null default '{2,5,10}',

  -- Graduation is this app's own event, and the reason to keep the tab open.
  graduation_on      boolean not null default true,

  /*
   * Below this, a position is not worth a buzz. Someone holding $3 of a coin
   * that went 10x made $27, and a phone lighting up for it is noise that
   * teaches them to disable the whole category.
   */
  min_position_usd   numeric not null default 10 check (min_position_usd >= 0),

  -- Local wall-clock, e.g. '22:00'. Null means no quiet hours.
  quiet_start        text,
  quiet_end          text,
  timezone           text not null default 'UTC',

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

/*
 * Where to send. One row per browser, not per person.
 *
 * Keyed by endpoint because that is what the push service issues and what
 * uniquely identifies a device — a person with a phone and a laptop has two,
 * and re-subscribing on the same device returns the same endpoint, so an upsert
 * here is an update rather than a duplicate.
 */
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    text not null references public.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

/*
 * What has already been sent.
 *
 * The primary key is the dedupe: `(user_id, kind, subject, rung)`. A holdings
 * milestone at 5x for one coin is one row, so the next twenty sweeps that also
 * observe 5x insert nothing. Without this the reconciler would notify on every
 * pass for as long as the condition held — which for a coin that has gone 10x
 * is forever.
 *
 * `rung` is the milestone multiple, or 0 for events that happen once and have
 * no magnitude (a follow, a graduation).
 */
create table if not exists public.notification_events (
  user_id  text not null references public.users (id) on delete cascade,
  kind     text not null check (kind in (
    'follow', 'reply', 'holding_multiple', 'watchlist_multiple', 'graduation', 'graduating_soon'
  )),
  -- A mint, a handle, or whatever identifies the thing the event is about.
  subject  text not null,
  rung     integer not null default 0,
  sent_at  timestamptz not null default now(),
  primary key (user_id, kind, subject, rung)
);

create index if not exists notification_events_recent
  on public.notification_events (user_id, sent_at desc);

-- Same posture as the other user-scoped tables: RLS on with no policies denies
-- anon access outright, and the service role the app reads with bypasses it.
-- Without this, anyone could enumerate who follows whom by push endpoint.
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_events enable row level security;
