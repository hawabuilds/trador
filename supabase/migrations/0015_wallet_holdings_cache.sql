-- Cached token balances per wallet, so a repeat Stonkfolio open can skip RPC
-- when the row is fresh. Prices are not stored here — the read path still
-- resolves assets from the store and reprices held stonks live.

create table if not exists public.wallet_holdings_cache (
  wallet       text primary key collate "C"
                 constraint wallet_holdings_cache_wallet_base58
                 check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  refreshed_at timestamptz not null default now(),
  sol_lamports bigint not null default 0 check (sol_lamports >= 0),
  balances     jsonb not null default '{}'::jsonb
);

alter table public.wallet_holdings_cache enable row level security;
