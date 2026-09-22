-- Each feed coin's trade tape and default chart, kept current by the worker.
--
-- A coin page used to read both from providers on demand, which meant the
-- first viewer of a coin — or anyone who landed on a server with a cold cache —
-- waited on Helius and CoinGecko. The worker now refreshes the coins people
-- are most likely to open every few seconds, and a page reads this row instead
-- when it is fresh. When it is not, or the worker is down, the page reads the
-- providers exactly as before, so nothing here is load-bearing.
--
-- `trades` is the tape as the trades route answers it, newest first, capped at
-- the same 300. `candles` holds each timeframe the worker keeps, keyed by
-- timeframe: {"1h": {"points": [...], "at": "<iso>"}}.

create table if not exists public.coin_tapes (
  mint        text primary key,
  pool        text not null,
  trades      jsonb not null default '[]'::jsonb,
  trades_at   timestamptz,
  candles     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Server-only: written by the worker and read by route handlers with the
-- service role, never by the browser.
alter table public.coin_tapes enable row level security;
