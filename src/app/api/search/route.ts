import {asPubkey} from "@/lib/pubkey";
import {optionalCaller} from "@/lib/server/auth";
import {publicJson} from "@/lib/server/http";
import {searchPeople} from "@/lib/server/social";
import {searchUniverse, stonkFor} from "@/lib/server/sources";
import {snapshotStocks} from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";

/**
 * Search across everything the app knows: coins, stocks and people.
 *
 * Coins come from the **live store**, not the bundled snapshot. That was the
 * bug: this route called `allStonks()`, which reads the 140 coins baked in at
 * build time, while the feed had moved to a store holding 685. Five out of six
 * coins in the app were unfindable by name, and the only symptom was a search
 * that returned nothing for a coin visibly sitting in the feed.
 *
 * A pasted mint is handled first and exactly: if the address resolves it is
 * returned, and if it does not, the answer says the coin is not in Trador
 * rather than returning nothing and letting the screen imply the address is
 * malformed. Those are different problems and only one is the user's fault.
 *
 * People are searched only when an account store is configured, and a failure
 * there returns no people rather than failing the whole search — a database
 * hiccup should not make coins unfindable too.
 */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

  if (query.length === 0) {
    return publicJson({stonks: [], stocks: [], people: [], pastedMint: null}, 30);
  }

  const stocks = snapshotStocks().items;

  // An exact mint match, before any text matching.
  const mint = asPubkey(query);
  if (mint) {
    const stonk = await stonkFor(mint);
    const stock = stocks.find((row) => row.mint === mint) ?? null;
    return publicJson(
      {
        stonks: stonk ? [stonk] : [],
        stocks: stock ? [stock] : [],
        people: [],
        // Told apart from "no results": a valid address that is simply not
        // listed here is worth saying out loud.
        pastedMint: stonk || stock ? null : mint,
      },
      30,
    );
  }

  // Symbols, names and handles are labels, so folding their case is correct —
  // unlike a mint, which is why this is the only lowercase in the file.
  const needle = query.toLowerCase(); // pubkey-lint-ok: a text query, not an address

  const caller = await optionalCaller(request);

  const [matchedStonks, people] = await Promise.all([
    searchUniverse(query),
    searchPeople(query, caller?.userId ?? null),
  ]);

  const matchedStocks = stocks
    .filter(
      (row) =>
        row.ticker.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle),
    )
    .slice(0, 25);

  return publicJson(
    {
      stonks: matchedStonks.slice(0, 25),
      stocks: matchedStocks,
      people,
      pastedMint: null,
    },
    30,
  );
}
