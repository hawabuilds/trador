-- Trending sort inputs beyond raw 24h volume.

alter table public.stonk_stats
  add column if not exists vol_1h numeric,
  add column if not exists txs_24h integer,
  add column if not exists unique_makers_24h integer,
  add column if not exists trending_score numeric,
  add column if not exists page_views integer not null default 0;

create index if not exists stonk_stats_trending_desc
  on public.stonk_stats (trending_score desc nulls last);

/*
 * Recreate the feed view so sorts can read the new stat columns.
 * Same drop-first pattern as 0002_feed_view.sql — `create or replace` cannot
 * reposition columns when `select s.*` widens.
 */
drop view if exists public.stonk_feed;

create view public.stonk_feed as
select
  s.*,
  st.last_price,
  st.last_mcap,
  st.liquidity_usd,
  st.vol_24h,
  st.vol_1h,
  st.txs_24h,
  st.unique_makers_24h,
  st.trending_score,
  st.page_views,
  st.price_change_24h,
  st.rewards_24h_usd,
  st.price_status,
  st.price_source,
  st.priced_at
from public.stonks s
left join public.stonk_stats st on st.mint = s.mint;

alter view public.stonk_feed set (security_invoker = on);
