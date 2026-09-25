-- Whether a person's Stonkfolio shows on their public profile.
--
-- On by default: a profile that shows what someone holds is the point of
-- following them. Off hides their holdings, their Stonkfolio value and their
-- wallet address from everyone but themselves. The chain itself stays public —
-- this governs what Trador shows, and the setting says so.

alter table public.users
  add column if not exists portfolio_public boolean not null default true;
