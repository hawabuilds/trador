-- Who brought whom: referral tracking for shared profile links.
--
-- A person's shared profile link is their referral link. `referred_by` is set
-- once, when a new account's row is first written, and never changed after —
-- so an existing user cannot be claimed by opening someone's link, and a
-- referral cannot be reassigned later.
--
-- `referral_visits` counts link opens, one row per visitor per referrer, so
-- opens and sign-ups can be compared. Tracking only: no rewards hang off this
-- yet, but they can be built on the same rows.

alter table public.users
  add column if not exists referred_by text references public.users (id) on delete set null,
  add column if not exists referred_at timestamptz;

create index if not exists users_referred_by on public.users (referred_by)
  where referred_by is not null;

create table if not exists public.referral_visits (
  referrer_id text not null references public.users (id) on delete cascade,
  -- A random id kept in the visitor's browser. Not personal data: it only
  -- stops one person opening a link ten times counting as ten opens.
  visitor     text not null,
  first_seen  timestamptz not null default now(),
  primary key (referrer_id, visitor)
);

-- Server-only: read and written through the database connection, never by the
-- browser.
alter table public.referral_visits enable row level security;
