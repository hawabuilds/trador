-- What a wallet was worth, over time.
--
-- The Stonkfolio reads holdings from the chain on every open, so the *current*
-- value needs no storage. A growth line does: nothing on chain records what a
-- wallet was worth last Tuesday, and recomputing it would mean replaying every
-- transfer against historical prices for every token — which is a different
-- product, and one that would still be wrong for anything the price ladder
-- cannot reach back for.
--
-- So the app samples instead. Each read of a wallet writes at most one row per
-- interval, and the chart draws what was actually observed. That has an honest
-- consequence worth stating plainly rather than hiding: **the line starts when
-- you first opened the app, not when you first bought.** The UI says so on an
-- empty chart instead of drawing a flat line back to zero, which would be a
-- fabricated history.

create table if not exists public.portfolio_snapshots (
  wallet    text not null collate "C"
              constraint portfolio_snapshots_wallet_base58
              check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  at        timestamptz not null default now(),

  -- What Trador could price at that moment. Never "everything in the wallet":
  -- a token outside the universe is counted separately and never folded in, so
  -- this column means the same thing on every row.
  total_usd numeric not null check (total_usd >= 0),

  -- Split out so a later chart can show what moved without another table. Both
  -- nullable because an early row may predate the split being recorded, and a
  -- zero there would claim the wallet held nothing of that kind.
  stonks_usd numeric,
  stocks_usd numeric,
  sol_usd    numeric,

  primary key (wallet, at)
);

/*
 * The read pattern is "one wallet, newest first, since a cutoff", which this
 * index serves exactly. `at desc` rather than ascending because every query
 * this table has walks backwards from now.
 */
create index if not exists portfolio_snapshots_wallet_at
  on public.portfolio_snapshots (wallet, at desc);

-- Same posture as the other user-scoped tables: RLS on with no policies denies
-- anon access outright, and the service role the app reads with bypasses it.
-- Without this, a wallet's balance history would be world-readable by address.
alter table public.portfolio_snapshots enable row level security;
