-- A view that joins a coin to its stats, so the feed can sort by them.
--
-- Why this exists: stats deliberately live in their own table, so a provider
-- outage can only cost decoration and can never remove a coin from the
-- universe. But that split means a sort by market cap has to reach across two
-- tables, and neither PostgREST nor a single-table query can express it —
-- which produced a feed that fetched an arbitrary page and then ranked only
-- those rows. The first live run put a $39K coin above a $7.6M one.
--
-- A LEFT JOIN keeps the property that matters: a coin with no stats row is
-- still in the view, and `nulls last` puts it after everything priced rather
-- than dropping it. Providers still cannot remove a row; they can only decide
-- where it ranks.

/*
 * Dropped and recreated, not `create or replace`.
 *
 * The body is `select s.*`, so every column added to `stonks` widens this view
 * and shifts the joined stat columns along by one. `create or replace view`
 * refuses that — it can only append columns, never reposition them — and fails
 * with "cannot change name of view column last_price to curve_progress". Since
 * every migration in this directory is re-run on each deploy, that turned the
 * next `alter table stonks add column` into a hard stop for the whole
 * migration run, which is how adding `curve_progress` blocked notifications.
 *
 * Dropping first is safe precisely because this is a view: it holds no data,
 * and nothing depends on it but queries that are recompiled anyway.
 */
drop view if exists public.stonk_feed;

create view public.stonk_feed as
select
  s.*,
  st.last_price,
  st.last_mcap,
  st.liquidity_usd,
  st.vol_24h,
  st.price_change_24h,
  st.rewards_24h_usd,
  st.price_status,
  st.price_source,
  st.priced_at
from public.stonks s
left join public.stonk_stats st on st.mint = s.mint;

-- The view is read through the service role, same as the tables. Supabase
-- treats a view as owned by its creator, so this makes the intent explicit
-- rather than relying on the default.
alter view public.stonk_feed set (security_invoker = on);

-- Sorting by a stat needs an index on the stats table, or every feed page is a
-- sequential scan over the join. These match the four sorts the feed offers.
create index if not exists stonk_stats_mcap_desc
  on public.stonk_stats (last_mcap desc nulls last);
create index if not exists stonk_stats_vol_desc
  on public.stonk_stats (vol_24h desc nulls last);
create index if not exists stonk_stats_rewards_desc
  on public.stonk_stats (rewards_24h_usd desc nulls last);
