/**
 * Capture a real snapshot of the universe, so the app runs with no keys at all.
 *
 * The predecessor app's best property was that its feed never went blank: the
 * chain decided what existed, Supabase stored it, and providers only decorated
 * it — so with every provider down the list still rendered, just without live
 * prices. A fresh checkout with no credentials deserves the same, and a
 * hand-written fixture would not: it would drift from what the chain actually
 * looks like and quietly become a lie about the product.
 *
 * So this writes a snapshot of real graduated, stock-paired launches, decorated
 * with real prices. The UI labels it as a snapshot rather than passing stale
 * numbers off as live.
 *
 * Two things are read from the chain rather than taken from a provider, because
 * they are the two a provider can be wrong about in ways nobody would notice:
 *
 *   - **Attribution.** Which launchpad a coin came from is decided by the pool's
 *     platform config. Jupiter happens to report a `launchpad` field too, and
 *     it is captured only so a disagreement is visible.
 *   - **Supply.** Market cap is price × measured supply. Without the supply read
 *     there is no market cap, and the row shows a price instead of inventing one.
 *
 *   npm run seed:snapshot
 */

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

import {MIN_LIQUIDITY_USD} from "@/config/liquidity";
import {POOL_STATUS, decodeStonkfunLaunch} from "@/lib/launchpad/launchpadPool";
import {LAUNCHPAD_POOL, RAYDIUM_LAUNCHPAD, STONKFUN_PLATFORMS} from "@/lib/programs";
import {encodeBase58, type Pubkey} from "@/lib/pubkey";
import {STOCK_MINTS} from "@/lib/stocks/registry";
import {isTradeableFromLiquidity} from "@/lib/threeState";
import {quoteKindFor} from "@/lib/universe";
import {jupiterPrices} from "./jupiter";
import {jupTokens} from "@/lib/server/live/jupTokens";
import {
  base64ToBytes,
  redactedRpcUrl,
  rpc,
  rpcCallCount,
} from "./rpc";

const OUT = path.join(process.cwd(), "src", "lib", "server", "snapshot.generated.json");

/** How many coins the snapshot carries. Enough to fill the feed and scroll. */
const LIMIT = 140;

/** A single byte, base58-encoded, for a memcmp on `status`. */
const statusFilter = (value: number) => encodeBase58(Uint8Array.from([value]));

async function graduatedStockPaired() {
  const found: {
    pool: Pubkey;
    launch: NonNullable<ReturnType<typeof decodeStonkfunLaunch>>;
  }[] = [];

  for (const platform of STONKFUN_PLATFORMS) {
    process.stdout.write(`  ${platform.kind}: graduated pools… `);

    const accounts = await rpc<{pubkey: string; account: {data: [string, string]}}[]>(
      "getProgramAccounts",
      [
        RAYDIUM_LAUNCHPAD,
        {
          encoding: "base64",
          commitment: "finalized",
          filters: [
            {dataSize: LAUNCHPAD_POOL.SPAN},
            {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platform.platformId}},
            {memcmp: {offset: LAUNCHPAD_POOL.STATUS, bytes: statusFilter(POOL_STATUS.TRADE)}},
          ],
        },
      ],
    );

    let paired = 0;
    for (const entry of accounts) {
      const launch = decodeStonkfunLaunch(base64ToBytes(entry.account.data[0]));
      // Arm 1 of the universe test, applied at capture time: only launches
      // priced against a *verified* stock go in.
      if (!launch?.stock) continue;
      found.push({pool: entry.pubkey as Pubkey, launch});
      paired += 1;
    }

    console.log(`${accounts.length} graduated, ${paired} stock-paired`);
  }

  return found;
}

async function main(): Promise<void> {
  console.log("Trador universe snapshot");
  console.log(`RPC  ${redactedRpcUrl()}\n`);

  const launches = await graduatedStockPaired();
  if (launches.length === 0) {
    console.log("\nNothing captured. Set HELIUS_RPC_URL if getProgramAccounts was refused.");
    return;
  }
  console.log(`\n  ${launches.length} graduated stock-paired launches`);

  const allMints = launches.map((entry) => entry.launch.pool.baseMint);

  /**
   * Stocks first, deliberately.
   *
   * The free price endpoint throttles on cumulative volume, and the stock list
   * is one batch of 29 against six batches of coins. Asking for the coins first
   * burns the quota and leaves every stock unpriced — which reads as a broken
   * registry rather than a throttled request, and is how the previous run
   * produced "0/29 priced".
   */
  process.stdout.write("  stock prices… ");
  const stockPrices = await jupiterPrices(STOCK_MINTS.map((stock) => stock.mint));
  console.log(`${stockPrices.size}/${STOCK_MINTS.length} priced`);

  process.stdout.write("  coin prices, liquidity, 24h change… ");
  const prices = await jupiterPrices(allMints);
  console.log(`${prices.size} priced`);

  // Rank by liquidity before spending name lookups and a supply read on them:
  // the deepest pools are the ones worth showing, and the tail is mostly coins
  // nobody can trade.
  const ranked = launches
    .map((entry) => ({
      ...entry,
      jup: prices.get(entry.launch.pool.baseMint) ?? null,
    }))
    .sort((a, b) => (b.jup?.liquidity ?? 0) - (a.jup?.liquidity ?? 0))
    .slice(0, LIMIT);

  const mints = ranked.map((entry) => entry.launch.pool.baseMint);

  /**
   * One call for names, artwork, supply and token program.
   *
   * This replaced a name lookup plus a mint-account read. It also carries the
   * `icon` already resolved from whichever gateway the creator used, which is
   * what puts real coin art in the feed instead of a monogram.
   */
  process.stdout.write("  names, artwork, supply… ");
  const tokens = await jupTokens(mints);
  console.log(`${tokens.size} resolved, ${[...tokens.values()].filter((t) => t.icon).length} with art`);

  let attributionDisagreements = 0;

  const stonks = ranked
    .map(({pool, launch, jup}) => {
      const mint = launch.pool.baseMint;
      const token = tokens.get(mint);

      // Jupiter's own launchpad label, compared against what the pool's
      // platform config says. Ours wins; a mismatch is worth counting.
      if (jup?.launchpad && jup.launchpad !== "stonkfun") attributionDisagreements += 1;

      const price = jup?.usdPrice ?? token?.usdPrice ?? null;
      const decimals = token?.decimals ?? jup?.decimals ?? null;

      // Measured, not guessed: price × real circulating supply, as reported by
      // the token API alongside the mint's own decimals. Without both there is
      // no market cap, and the row shows a price instead of inventing one.
      const circulatingSupply = token?.circSupply ?? null;

      const marketCapUsd =
        price !== null && circulatingSupply !== null ? price * circulatingSupply : null;

      return {
        mint,
        pool,
        symbol: token?.symbol ?? "",
        name: token?.name ?? "",
        icon: token?.icon ?? null,
        configKind: launch.configKind,
        paysHolders: launch.paysHolders,
        quoteMint: launch.pool.quoteMint,
        quoteTicker: launch.stock!.ticker,
        quoteKind: quoteKindFor(launch.pool.quoteMint),
        creator: launch.pool.creator,
        priceUsd: price,
        changePct: jup?.priceChange24h ?? null,
        // Stored so the chart page can rescale the cap against a fresher price
        // rather than showing a figure computed at capture time.
        decimals,
        circulatingSupply,
        marketCapUsd,
        liquidityUsd: jup?.liquidity ?? null,
        isTradeable: isTradeableFromLiquidity(jup?.liquidity ?? null, MIN_LIQUIDITY_USD),
        listedAt: jup?.createdAt ?? null,
      };
    })
    // A coin whose symbol never resolved renders as a blank row, which reads as
    // a bug rather than as missing metadata.
    .filter((stonk) => stonk.symbol !== "");

  /**
   * A throttled run must not delete what a previous run captured.
   *
   * This is the same rule the app itself follows — providers decorate, they do
   * not decide what exists — applied to the generator. The free price endpoint
   * rate-limits by IP over a window, so re-running this a few times in a row
   * will eventually return nothing for a batch. Writing that straight out
   * replaces 29 real stock prices with an empty object, and the Stocks tab goes
   * to dashes for reasons that have nothing to do with the stocks.
   *
   * So a fetch that came back empty falls through to whatever the last good
   * snapshot held, and the run says which numbers are carried over.
   */
  const previous: Record<string, unknown> = existsSync(OUT)
    ? ((JSON.parse(readFileSync(OUT, "utf8")) as {stocks?: Record<string, unknown>})
        .stocks ?? {})
    : {};

  const fresh = Object.fromEntries(
    [...stockPrices.entries()].map(([mint, row]) => [
      mint,
      {
        priceUsd: row.usdPrice,
        changePct: row.priceChange24h,
        liquidityUsd: row.liquidity,
        // The underlying equity's own price and market cap, when the provider
        // carries them. Shown as reference, never as the token's own price.
        underlying: row.underlying,
      },
    ]),
  );

  const stocks = {...previous, ...fresh};
  const carried = Object.keys(previous).filter((mint) => !(mint in fresh)).length;

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        source: "StonkFun launches on Raydium LaunchLab, finalized commitment",
        note:
          "Real mainnet launches, captured so the app renders with no credentials. " +
          "Attribution and supply come from chain state; prices, liquidity and 24h " +
          "change are decoration. The UI must label this as a snapshot.",
        stonks,
        stocks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const priced = stonks.filter((stonk) => stonk.priceUsd !== null).length;
  const withMcap = stonks.filter((stonk) => stonk.marketCapUsd !== null).length;
  const tradeable = stonks.filter((stonk) => stonk.isTradeable === true).length;

  console.log(`\n  ${stonks.length} stonks written → ${path.relative(process.cwd(), OUT)}`);
  console.log(`  priced ${priced}  ·  market cap ${withMcap}  ·  tradeable ${tradeable}`);

  const byQuote = new Map<string, number>();
  for (const stonk of stonks) {
    byQuote.set(stonk.quoteTicker, (byQuote.get(stonk.quoteTicker) ?? 0) + 1);
  }
  console.log(
    `  quoted in: ${[...byQuote.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([ticker, count]) => `${ticker} ${count}`)
      .join(", ")}`,
  );

  console.log(
    `  stock prices: ${Object.keys(fresh).length} fresh` +
      (carried > 0 ? `, ${carried} carried over from the last snapshot` : ""),
  );
  console.log(
    attributionDisagreements === 0
      ? "  attribution: Jupiter agrees on every coin"
      : `  attribution: ⚠ Jupiter disagrees on ${attributionDisagreements} coin(s) — ours is from the pool`,
  );
  console.log(`\n  ${rpcCallCount()} RPC calls.\n`);
}

main().catch((error) => {
  console.error(`\nsnapshot failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
