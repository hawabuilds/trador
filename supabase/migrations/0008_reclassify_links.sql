-- Move social links into the slot their host earns.
--
-- Until now the indexer filed Jupiter's two link fields by field name, so a
-- creator who put their X profile in the token metadata's `website` had it
-- stored as a website. The coin then rendered a globe icon and no X icon while
-- plainly having an X account.
--
-- The indexer now classifies by host, but that alone does not repair what is
-- already stored: every optional column is written with
-- `coalesce(excluded.col, stonks.col)`, so a pass that returns the link under
-- its correct slot sets `twitter` and leaves the stale `website` in place. The
-- coin would then show both icons, both pointing at X.
--
-- So this moves them once, here, and the indexer keeps them right from now on.
-- Only rows whose target slot is empty are moved — a coin with a real X link
-- *and* an X URL in the website slot loses the duplicate, not the original.

update public.stonks
   set twitter = coalesce(twitter, website),
       website = null
 where website ~* '^https?://(www\.)?(x\.com|twitter\.com)/';

update public.stonks
   set telegram = coalesce(telegram, website),
       website = null
 where website ~* '^https?://(www\.)?(t\.me|telegram\.(me|org))/';

update public.stonks
   set discord = coalesce(discord, website),
       website = null
 where website ~* '^https?://(www\.)?(discord\.(gg|com)|discordapp\.com)/';
