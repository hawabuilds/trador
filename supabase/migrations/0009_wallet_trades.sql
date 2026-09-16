-- A wallet's trades, as read from the chain.
--
-- Trador never recorded a trade: the ticket signs and sends, and the chain is
-- the record. Trade history and profit need that record in a form that can be
-- listed and summed, and reading it back means parsing every transaction the
-- wallet ever signed — the expensive tier of the RPC provider. So each
-- transaction is parsed once and kept here, and a cursor remembers how far the
-- sync has read so the next visit only parses what is new.
--
-- Every swap counts, wherever it was made: Phantom, Jupiter or Trador. Trades
-- are derived from the wallet's own balance changes, because the provider's
-- transaction labels are unreliable (a real ALLINU buy came back as TRANSFER).

create table if not exists public.wallet_trades (
  wallet      text not null collate "C"
                constraint wallet_trades_wallet_base58
                check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signature   text not null collate "C",
  -- The asset traded. SOL is stored as the wrapped-SOL mint.
  mint        text not null collate "C",
  side        text not null check (side in ('buy', 'sell')),
  amount      numeric not null check (amount > 0),
  -- What it was paid for with, or paid out in.
  paid_mint   text not null collate "C",
  paid_amount numeric not null check (paid_amount > 0),
  -- Null when the paid side had no known dollar price at the time. Never zero:
  -- an unpriced trade is not a free one, and profit must say it is partial.
  value_usd   numeric check (value_usd is null or value_usd >= 0),
  price_usd   numeric check (price_usd is null or price_usd >= 0),
  at          timestamptz not null,

  primary key (wallet, signature, mint)
);

-- History reads newest first, for a wallet or one coin in it.
create index if not exists wallet_trades_wallet_at
  on public.wallet_trades (wallet, at desc);
create index if not exists wallet_trades_wallet_mint_at
  on public.wallet_trades (wallet, mint, at desc);

create table if not exists public.wallet_trade_cursors (
  wallet         text primary key collate "C"
                   constraint wallet_trade_cursors_wallet_base58
                   check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  -- Newest signature already read, trade or not.
  head_signature text,
  synced_at      timestamptz not null default now()
);

-- Same posture as the other wallet-scoped tables: RLS on with no policies, so
-- anon cannot read a wallet's trading by address. The app's service role
-- bypasses it.
alter table public.wallet_trades enable row level security;
alter table public.wallet_trade_cursors enable row level security;
