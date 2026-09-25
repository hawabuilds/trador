-- The transaction that created a coin, when Create registered it.
--
-- Optional: indexer-discovered rows have no signature to store, and a confirm
-- that lands before the column exists must still write the rest of the row.
-- Base58, COLLATE "C", never case-folded — same rule as every other chain id.

alter table public.stonks
  add column if not exists launch_signature text collate "C";
