import {asPubkey} from "@/lib/pubkey";
import {publicJson} from "@/lib/server/http";
import {allStonks} from "@/lib/server/sources";
import {snapshotStocks} from "@/lib/server/snapshot";

export const dynamic = "force-dynamic";

/**
 * Search across both sides of the universe.
 *
 * A pasted mint is handled first and exactly: if the address is in the store it
 * resolves, and if it is not, the answer says the coin is not in Trador rather
 * than returning nothing and letting the screen imply the address is invalid.
 * Those are different problems and only one of them is the user's fault.
 */
export async function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

  if (query.length === 0) {
    return publicJson({stonks: [], stocks: [], pastedMint: null}, 30);
  }

  const stonks = allStonks();
  const stocks = snapshotStocks().items;

  // An exact mint match, before any text matching.
  const mint = asPubkey(query);
  if (mint) {
    const stonk = stonks.find((row) => row.mint === mint) ?? null;
    const stock = stocks.find((row) => row.mint === mint) ?? null;
    return publicJson(
      {
        stonks: stonk ? [stonk] : [],
        stocks: stock ? [stock] : [],
        // Told apart from "no results": a valid address that is simply not
        // listed here is worth saying out loud.
        pastedMint: stonk || stock ? null : mint,
      },
      30,
    );
  }

  // Symbols and names are labels, so folding their case is correct — unlike a
  // mint, which is why this is the only lowercase in the file.
  const needle = query.toLowerCase(); // pubkey-lint-ok: a text query, not an address

  const matchedStonks = stonks
    .filter(
      (row) =>
        row.symbol.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.quoteTicker.toLowerCase().includes(needle),
    )
    .slice(0, 25);

  const matchedStocks = stocks
    .filter(
      (row) =>
        row.ticker.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle),
    )
    .slice(0, 25);

  return publicJson({stonks: matchedStonks, stocks: matchedStocks, pastedMint: null}, 30);
}
