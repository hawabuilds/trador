-- When a coin graduated, as opposed to when its token was minted.
--
-- `listed_at` is Jupiter's `createdAt`: the moment the mint account was
-- created. For a feed of graduated coins sorted by "New" that is the wrong
-- clock — a token minted ten days ago that bonded twenty minutes ago is the
-- newest thing on the launchpad, and it was rendering as "10d" and sorting
-- below coins that graduated yesterday.
--
-- This records the first sweep that saw the pool in its graduated state. It is
-- "when Trador first saw it graduate" rather than the exact on-chain migration
-- slot, and the difference is at most one sweep. Reconstructing the true moment
-- would mean finding the migration transaction for every coin, which is a
-- signature crawl per mint to sharpen a timestamp by ninety seconds.

alter table public.stonks
  add column if not exists graduated_at timestamptz;

/*
 * Backfill from what is already known.
 *
 * `created_at` is when the reconciler first wrote the row, and for every row
 * written by the graduated sweep that is also when it was first seen graduated.
 * Rows that arrived as `pending` and graduated later get a slightly early
 * timestamp, which is better than a null that sorts them out of the feed.
 */
update public.stonks
   set graduated_at = created_at
 where status = 'listed' and graduated_at is null;

/*
 * The New feed.
 *
 * Ordered by graduation, and `nulls last` is deliberately *not* how the feed
 * reads it any more — see `stonks_new_feed` usage. A null here now only occurs
 * for a row mid-write.
 */
create index if not exists stonks_graduated_at
  on public.stonks (graduated_at desc nulls last, mint)
  where status = 'listed' and eligible is distinct from false;

/*
 * Decoration order, which is a different question entirely.
 *
 * The decorate pass reads a capped page, and it used to take that page in
 * `listed_at desc nulls last` order. That starved exactly the rows that needed
 * it: a freshly graduated coin has no `listed_at` until decoration gives it
 * one, so it sorted last, fell outside the cap, and could never be decorated —
 * 94 of 693 coins were permanently unnamed and unpriced. This index serves the
 * replacement order, which takes undecorated rows first.
 */
create index if not exists stonks_undecorated_first
  on public.stonks ((symbol is null) desc, graduated_at desc nulls last)
  where status = 'listed';
