-- How a coin was launched: on a bonding curve, or straight into a pool.
--
-- Until now every row was a curve launch, so nothing needed to say so. StonkFun
-- also opens coins directly into a Raydium CLMM pool with no curve at all, and
-- those behave differently in two ways the app has to know about:
--
--   * They are tradeable from the first block, so there is no graduation. The
--     moment they entered the feed is the moment the token was created, which
--     is exactly the value `graduated_at` must *not* take for a curve launch —
--     there the token's creation can be weeks before it graduated.
--   * They have no LaunchLab platform config, so `config_kind` is empty and
--     `pays_holders` is unknown rather than false.
--
-- Nullable, three-state like every other flag here: null means "not recorded",
-- not "neither".

alter table public.stonks add column if not exists pool_kind text;

alter table public.stonks drop constraint if exists stonks_pool_kind_check;
alter table public.stonks
  add constraint stonks_pool_kind_check
  check (pool_kind is null or pool_kind in ('curve', 'clmm'));

-- Every row stored before this column existed came from a curve: the LaunchLab
-- sweep, the graduating sweep, or pump.fun's custom-pair curves.
update public.stonks set pool_kind = 'curve' where pool_kind is null;

-- The decorate pass reads coins stalest-price-first so a universe of thousands
-- rotates through refreshes instead of re-pricing the newest few hundred
-- forever.
create index if not exists stonk_stats_priced_at
  on public.stonk_stats (priced_at asc nulls first);
