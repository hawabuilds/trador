-- How far a launch is along its bonding curve.
--
-- StonkFun's graduation trigger is not a market cap. Every pool carries the
-- same constant — 793,100,000 of a 1,000,000,000 supply, 79.31% — and selling
-- that much migrates the launch into a Raydium CPMM pool. What varies is the
-- quote side: each stock has its own config, sized so the raise was worth about
-- $8,200 when that stock was added. So "progress" is the only comparable number
-- across coins priced in different stocks, and it is read from the pool itself:
-- quote raised / fund-raising target.
--
-- Stored as a fraction in [0, 1] rather than a percentage, because every other
-- ratio in this schema is a fraction and mixing the two is how a progress bar
-- ends up 100x too long exactly once.
--
-- Null means unmeasured, not zero. A graduated coin has no meaningful progress
-- (it is done) and a coin the curve sweep has not reached yet has none either —
-- rendering either as 0% would say "nobody has bought this", which is a claim
-- about the coin rather than about our data.

alter table public.stonks
  add column if not exists curve_progress numeric
    constraint stonks_curve_progress_range
    check (curve_progress is null or (curve_progress >= 0 and curve_progress <= 1));

/*
 * The graduating feed.
 *
 * Partial on `status = 'pending'` because that is the only status this surface
 * shows — a graduated coin belongs in the main feed, not here. Ordered by
 * progress descending, which is the order the tab reads in.
 *
 * `eligible is distinct from false` repeats the three-state rule so the planner
 * can use this index for the query the feed actually writes. A query that says
 * `and eligible` loses the index and gets slow, which is a far better outcome
 * than one that silently returns fewer rows.
 */
create index if not exists stonks_graduating
  on public.stonks (curve_progress desc nulls last, mint)
  where status = 'pending' and eligible is distinct from false;
