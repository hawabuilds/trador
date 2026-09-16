-- Discord links.
--
-- The other three social columns have existed since the first migration; this
-- one was missed because Jupiter never returns a discord link, so nothing had
-- anything to store. DexScreener does return them, which is what makes the
-- column worth adding rather than dropping the field on read.
--
-- Nullable with no default: a null here means "nobody has told us", not "there
-- is no discord", which is the same three-state reading every other optional
-- column on this table gets.

alter table public.stonks add column if not exists discord text;
