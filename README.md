# Trador

Coins priced in stocks, on Solana.

Two launchpads now let a creator pick a tokenized stock as the quote asset —
**StonkFun**, which runs on Raydium LaunchLab, and **pump.fun Custom Pairs**. So
a coin can be denominated in NVDAx instead of SOL, and a StonkFun reward launch
routes a share of every trade back to holders in stock. Trador is the feed,
chart, order ticket and launchpad for that.

```bash
npm install
npm run dev
```

It runs with no keys. Without Privy the session is a demo that cannot sign;
without Supabase the feed reads a captured snapshot of real launches. Charts,
the trade tape, news, search, the Stonkfolio and Jupiter quotes all work
keyless. The indexer and the probe scripts need an RPC that allows
`getProgramAccounts`, which public endpoints refuse.

## Vocabulary

**Stocks** are verified tokenized equities, ETFs, commodities and pre-IPO names —
things with a custodian behind them. **Stonks** are launchpad coins priced
against one. The two words stay distinct throughout because one of the two is
backed by an asset and the other is not, and a shared word would hide precisely
that. Your holdings are your **Stonkfolio**.

## Screens

| Route | What it is |
| --- | --- |
| `/` | Landing, with real counts from the universe |
| `/home` | Watchlist / Stonks / Stocks, with per-tab sort rails |
| `/stonk/[mint]` | Chart, timeframes, live tape, comments, info, Buy/Sell |
| `/stock/[ticker]` | Same, plus issuer, sector and price-source honesty |
| `/search` | Stocks and coins; a pasted mint resolves directly |
| `/news` | Coverage of the companies behind the stocks being traded against |
| `/learn` | Three lessons. Finishing them unlocks Create |
| `/stonkfolio` | On-chain holdings, split into stocks and stonks |
| `/create` | Plan a launch against live chain state |

## What is live

| Surface | Source |
| --- | --- |
| Coin universe | Captured snapshot of real StonkFun launches; Supabase when configured |
| Prices, liquidity, 24h change | Jupiter |
| Candles, trade tape | GeckoTerminal, oriented by mint so the chart is never inverted |
| Market caps | Price × supply measured on chain. Never a guess |
| News | Yahoo per-ticker RSS, keyless |
| Stonkfolio | `getTokenAccountsByOwner` across both token programs |
| Quotes and swaps | Jupiter, 50 bps platform fee, one signature |
| Create | Plans against chain state; does not sign — see below |

The chain decides what exists. The store keeps it. Providers only decorate it.
If every provider is down the feed still renders without live prices.

## Membership

A coin is in Trador when it was launched by a program we recognise **and**
either its quote asset is a verified tokenized stock, or it is quoted in SOL or
a stablecoin and pays holders in a stock. Coins still on the bonding curve are
stored as `pending` and hidden; graduated coins are `listed`.

Attribution comes from program-owned account state, never from a token's name,
symbol or a listing site. A StonkFun launch is identifiable because its
LaunchLab pool records StonkFun's platform config. Jupiter reports a `launchpad`
field too and agrees with us on every coin in the snapshot — it is captured as a
cross-check, never as the authority.

## The stock registry is a trust boundary

`src/lib/stocks/mints.generated.json` decides which mints a coin is allowed to
claim a pairing against. A wrong entry is a laundering route: mint a token
called `OPENAI`, pair a coin to it, and the coin inherits a real asset's
credibility.

So the list is derived, not asserted. `npm run sync:stocks` censuses every
StonkFun pool, ranks mints by how many launches price against them, reads each
candidate's mint account, groups by **mint authority**, and emits only the
families whose authority is recognised. Two findings from that census are why
the authority is the test rather than a name or an address prefix:

- `xSOL` ("Hylo Leveraged SOL") is quoted against by 718 launches and would pass
  any prefix rule aimed at xStocks. It is a leveraged SOL derivative.
- `tOpenAI` sits in the census beside PreStocks' `OPENAI` under a different
  authority. Two tokens offering OpenAI exposure, one issuer verified and one
  not. Names cannot separate them; authorities can, immediately.

Currently verified: 23 xStocks (one Backed authority) and 6 PreStocks (one
PreStocks authority). Backpack Securities equities are real and excluded by
default, because each of their mints carries its own authority — membership
would be a maintained allowlist rather than one key that proves the family.
`INCLUDE_BACKPACK=1` on a sync run admits them.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Full suite, no network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run probe:accounts` | Read the mainnet accounts the build depends on |
| `npm run probe:quotes` | Census every quote asset StonkFun launches use |
| `npm run sync:stocks` | Regenerate the stock registry (`--write` to commit it) |
| `npm run seed:snapshot` | Recapture the universe snapshot |

## Two rules that are not negotiable

**Addresses are base58 and case-sensitive.** There is no normalisation step,
because there is nothing to normalise. Never `.toLowerCase()` a mint — `So111…`
and `so111…` are different strings and only one is an account. Folding case
corrupts silently: the lookup misses, or one mint's price is filed under
another's. `test/pubkey-lint.test.ts` enforces this, and it earned its place —
it caught five real case-folding bugs in code ported from the EVM app, including
one that would have filed one wallet's holdings under another's cache key.

**Nullable flags are three-state.** `true` show, `false` hide, `null` *not yet
evaluated* → **show**. Never `.eq(column, true)`. On Solana `eligible` also
carries confirmation state — a launch seen at `confirmed` is null until it
finalizes.

## Where pump.fun Custom Pairs actually live

Worth writing down, because the obvious place is the wrong one.

pump.fun's bonding curve is SOL-only and always has been — its `BondingCurve`
account carries no quote mint, and neither `create` nor `create_v2` accepts one.
Custom Pairs are a **PumpSwap AMM** feature: the `Pool` account holds `base_mint`
and `quote_mint` side by side, so a coin priced in NVDAx is a PumpSwap pool whose
quote mint is the stock.

Offsets were derived from the IDL and then confirmed against mainnet: a `memcmp`
for WSOL at `quote_mint` returns 146,685 pools, and the same filter for a stock
mint returns real stock-quoted pools whose base mint is a pump.fun coin.

**Two account sizes are live and both matter.** 301 is current (142,317 pools),
245 is legacy (4,368). Fields were appended rather than inserted, so the offsets
are shared — which is exactly why pump pools must not be filtered by `dataSize`.
Pinning 245, the size the SDK types suggest, would find the 4,368 oldest pools
and silently miss 97% of the program including every Custom Pair.

## Why Create plans but does not sign

The Create screen resolves a real plan from chain state — the program, the
config that governs it, whether that config is owned by LaunchLab and names
StonkFun, the quote mint, the rent and fees — and then says it will not sign.

That is not an unfinished feature. **pump.fun is not deployed on devnet**, so its
create instruction cannot be exercised anywhere except mainnet with real money.
LaunchLab has a devnet deployment, but its devnet configs do not mirror
mainnet's, so the stock-quoted path is not meaningfully testable there either.
An instruction that has never once executed successfully, behind a button that
spends SOL, is not a feature — it is a way to lose someone else's money while
looking finished.

One check is also still genuinely open: whether StonkFun's platform config
permits a third party to launch under it. The config exists, is owned by
LaunchLab and names StonkFun, but the restriction flags have not been decoded
from a source worth trusting, so the screen reports that as **not verified**
rather than guessing.
