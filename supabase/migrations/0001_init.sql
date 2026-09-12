-- Trador's store.
--
-- The chain decides what exists, this stores it, and providers only decorate
-- it. So every column here is either read from chain state or is a provider
-- figure that is allowed to be stale, and the two are not mixed in a way that
-- lets a provider outage remove a row.
--
-- Two decisions run through the whole file and are worth reading first.
--
-- 1. **Addresses are `COLLATE "C"`.** Base58 is case-sensitive, and Postgres's
--    default collation orders text case-insensitively. Keyset pagination
--    compares a cursor against an indexed column, so a default-collated index
--    and a byte-ordered cursor disagree — and the page silently skips rows.
--    The `CHECK` constraints reject anything that is not base58 outright, so a
--    lowercased mint fails loudly at the boundary instead of becoming a row
--    that never matches again.
--
-- 2. **Nullable flags are three-state.** `true` show, `false` hide, `null` not
--    yet evaluated → **show**. Every read must use `IS DISTINCT FROM false`,
--    never `AND flag`. Two-state filtering emptied the predecessor app's feed
--    three times, which is why the feed index below encodes the rule rather
--    than trusting each query to remember it.

create extension if not exists pg_trgm;

-- Base58 excludes 0, O, I and l. A 32-byte key is 32-44 characters.
--
-- Wrapped in a DO block because Postgres has no `create domain if not exists`,
-- and every migration here has to survive being re-run -- that is how a new
-- file gets applied. The first re-run failed on exactly this line.
do $$
begin
  create domain base58_pubkey as text
    constraint base58_pubkey_check
    check (value ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------
-- The universe
-- ---------------------------------------------------------------------------

create table if not exists public.stonks (
  mint            text primary key collate "C"
                    constraint stonks_mint_base58
                    check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),

  -- Attribution, proved from program-owned account state. Never from a name.
  launchpad       text not null check (launchpad in ('stonkfun', 'pumpfun')),
  pool            text collate "C",
  -- StonkFun's platform config, or pump's pool. What proves the launchpad.
  platform_config text collate "C",
  config_kind     text check (config_kind in ('rewards', 'standard')),
  creator         text collate "C",

  symbol          text,
  name            text,
  decimals        smallint,
  token_program   text collate "C",

  -- What the coin is priced in.
  quote_mint      text collate "C",
  quote_ticker    text,
  quote_kind      text check (quote_kind in ('stock', 'sol', 'stable', 'other')),

  -- Does the launch route a share of every trade back to holders, in stock?
  pays_holders    boolean,
  reward_stock    text,

  total_supply    numeric,
  -- Measured: price × supply. Null when supply was never read, because
  -- multiplying a price by a guess is how a feed starts inventing numbers.
  circulating_supply numeric,

  status          text not null default 'pending'
                    check (status in ('pending', 'listed')),

  -- Three-state. `eligible` also carries confirmation state: a launch seen at
  -- `confirmed` commitment is null until it finalizes, true once it does, and
  -- false if the fork it arrived on was dropped — the row is kept either way.
  eligible        boolean,
  is_tradeable    boolean,
  -- Null until pump.fun's Custom Pairs layout is verified for this row.
  is_custom_pair  boolean,

  image_url       text,
  image_source    text,
  image_64        text,
  image_128       text,
  image_color     text,

  twitter         text,
  telegram        text,
  website         text,

  listed_at       timestamptz,
  indexed_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

/*
 * The feed index, with the three-state rule compiled into it.
 *
 * A partial index on `eligible IS DISTINCT FROM false` means the planner can
 * only use it for a query that filters the same way — so a query that writes
 * `AND eligible` loses the index and gets slow, which is a far better outcome
 * than one that silently returns fewer rows.
 */
create index if not exists stonks_feed
  on public.stonks (listed_at desc, mint)
  where status = 'listed' and eligible is distinct from false;

create index if not exists stonks_quote_mint on public.stonks (quote_mint);
create index if not exists stonks_launchpad on public.stonks (launchpad);
create index if not exists stonks_status on public.stonks (status);
create index if not exists stonks_listed_at on public.stonks (listed_at desc);
create index if not exists stonks_symbol_trgm on public.stonks using gin (symbol gin_trgm_ops);
create index if not exists stonks_name_trgm on public.stonks using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Provider decoration, kept apart from what the chain said
-- ---------------------------------------------------------------------------

create table if not exists public.stonk_stats (
  mint              text primary key collate "C"
                      references public.stonks (mint) on delete cascade,
  last_price        numeric,
  last_mcap         numeric,
  liquidity_usd     numeric,
  vol_24h           numeric,
  price_change_24h  numeric,
  rewards_24h_usd   numeric(20, 2),
  /*
   * Which of three things happened, rather than a nullable price.
   *
   * `priced` we have a number, `no_pool` nothing trades it yet, `failed` the
   * provider errored. Collapsing these to a null price renders as $0 on screen,
   * which is the one formatting lie a user cannot detect.
   */
  price_status      text check (price_status in ('priced', 'no_pool', 'failed')),
  price_source      text check (price_source in ('oracle', 'pool', 'curve', 'snapshot')),
  priced_at         timestamptz,
  updated_at        timestamptz not null default now()
);

create index if not exists stonk_stats_mcap on public.stonk_stats (last_mcap desc nulls last);
create index if not exists stonk_stats_liquidity on public.stonk_stats (liquidity_usd desc nulls last);
create index if not exists stonk_stats_rewards on public.stonk_stats (rewards_24h_usd desc nulls last);

create table if not exists public.stonk_pools (
  pool          text primary key collate "C",
  mint          text not null collate "C"
                  references public.stonks (mint) on delete cascade,
  quote_mint    text collate "C",
  dex           text,
  liquidity_usd numeric,
  /*
   * True while this is a bonding curve rather than a pool.
   *
   * A curve's seeded `virtual` reserves are not liquidity, and every provider
   * will report them as if they were. The predecessor app shipped a feed where
   * fourteen of twenty new rows showed near-identical "liquidity" for exactly
   * this reason, one of them reading half a billion dollars. An `is_curve` row
   * never contributes to a liquidity figure.
   */
  is_curve      boolean not null default false,
  updated_at    timestamptz not null default now()
);

create index if not exists stonk_pools_mint on public.stonk_pools (mint);

-- ---------------------------------------------------------------------------
-- Indexer bookkeeping
-- ---------------------------------------------------------------------------

create table if not exists public.indexer_state (
  name          text primary key,
  -- A slot, not a block number. Solana's unit of progress.
  last_slot     bigint not null default 0,
  slots_behind  bigint,
  last_run_at   timestamptz,
  -- Set while a worker holds the pass, so a second one can tell it is stale.
  heartbeat_at  timestamptz,
  note          text
);

create table if not exists public.batch_cursors (
  name        text primary key,
  -- Keyset cursors, never OFFSET: a backfill that re-sorts under an offset
  -- silently reprocesses and skips rows.
  cursor      text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  -- Privy's DID. Identity comes from the access token, never from the body.
  id           text primary key,
  handle       text unique,
  display_name text,
  pfp_url      text,
  wallet       text collate "C",
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.watchlist (
  user_id    text not null references public.users (id) on delete cascade,
  -- `stonk` or `stock`. One list holds both sides of the universe.
  kind       text not null check (kind in ('stonk', 'stock')),
  -- A mint for a coin, a ticker for a stock. Stored verbatim.
  asset_id   text not null collate "C",
  created_at timestamptz not null default now(),
  primary key (user_id, kind, asset_id)
);

create table if not exists public.comments (
  id         bigserial primary key,
  user_id    text not null references public.users (id) on delete cascade,
  kind       text not null check (kind in ('stonk', 'stock')),
  asset_id   text not null collate "C",
  parent_id  bigint references public.comments (id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_asset on public.comments (kind, asset_id, created_at desc);

create table if not exists public.follows (
  follower_id text not null references public.users (id) on delete cascade,
  followee_id text not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

-- ---------------------------------------------------------------------------
-- News
-- ---------------------------------------------------------------------------

create table if not exists public.news_articles (
  id           text primary key,
  ticker       text,
  title        text not null,
  url          text not null,
  source       text,
  summary      text,
  -- Real article artwork, resolved from the page's OG tags.
  image_url    text,
  published_at timestamptz not null,
  created_at   timestamptz not null default now()
);

create index if not exists news_published on public.news_articles (published_at desc);
create index if not exists news_ticker on public.news_articles (ticker, published_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

-- The app reads the universe through the service role and writes nothing from
-- the browser, so these carry RLS with no policies: enabled denies anon access
-- outright, and the service role bypasses it.
alter table public.users enable row level security;
alter table public.watchlist enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

-- Where the indexer starts. A slot of 0 means "reconcile everything", which is
-- what a first run should do.
insert into public.indexer_state (name, last_slot, note)
values
  ('stonkfun:reconcile', 0, 'getProgramAccounts sweep of LaunchLab under StonkFun configs'),
  ('pumpfun:reconcile', 0, 'PumpSwap pools whose quote mint is a verified stock'),
  ('live-tip', 0, 'Signature tail on the platform configs')
on conflict (name) do nothing;
