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

Copy `.env.local.example` to `.env.local`. It runs with no keys — without Privy
the login is faked in the browser, and without Supabase the feed reads a seeded
snapshot. The indexer and the probe scripts need an RPC that allows
`getProgramAccounts`, which public endpoints refuse.

## Vocabulary

**Stocks** are verified tokenized equities, ETFs, commodities and pre-IPO names —
things with a custodian behind them. **Stonks** are launchpad coins priced
against one. The two words stay distinct throughout because one of the two is
backed by an asset and the other is not, and a shared word would hide precisely
that. Your holdings are your **Stonkfolio**.

## What is live

| Surface | Source |
| --- | --- |
| Coin universe, search, New feed | Supabase, filled by the on-chain indexer |
| Stock prices | Pyth, for anything with a listed underlying |
| Stonk prices, candles, tape | Jupiter / DexScreener / GeckoTerminal decorate rows that already exist |
| Stonkfolio balances | On-chain, across Privy and imported wallets |
| Buy / sell | Jupiter Swap API, 50 bps platform fee, one signature |
| Create | pump.fun and StonkFun launch instructions, simulated before signing |
| Comments, profiles, follows, Learn | Supabase when configured |

The chain decides what exists. Supabase stores it. Providers only decorate it.
If every provider is down the feed still renders from Supabase without live
prices.

## Membership

A coin is in Trador when it was launched by a program we recognise **and**
either its quote asset is a verified tokenized stock, or it is quoted in SOL or
a stablecoin and pays holders in a stock. Coins still on the bonding curve are
stored as `pending` and hidden; graduated coins are `listed`.

Attribution comes from program-owned account state, never from a token's name,
symbol or a listing site. A StonkFun launch is identifiable because its
LaunchLab pool records StonkFun's platform config.

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

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm test` | Full suite, no network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run probe:accounts` | Read the mainnet accounts the build depends on |
| `npm run probe:quotes` | Census every quote asset StonkFun launches use |
| `npm run sync:stocks` | Regenerate the stock registry (`--write` to commit it) |
| `npm run probe:pump <mint>` | Settle pump.fun's Custom Pairs account layout |
| `npm run worker` | The always-on launch indexer |
| `npm run create:dry-run` | Build and simulate a launch without signing |

## Two rules that are not negotiable

**Addresses are base58 and case-sensitive.** There is no normalisation step,
because there is nothing to normalise. Never `.toLowerCase()` a mint — `So111…`
and `so111…` are different strings and only one is an account. Folding case
corrupts silently: the lookup misses, or one mint's price is filed under
another's. `test/pubkey-lint.test.ts` enforces this.

**Nullable flags are three-state.** `true` show, `false` hide, `null` *not yet
evaluated* → **show**. Never `.eq(column, true)`. On Solana `eligible` also
carries confirmation state — a launch seen at `confirmed` is null until it
finalizes — and `is_custom_pair` stays null until pump.fun's layout is verified.

## Known unknown: pump.fun Custom Pairs

pump.fun's published program docs describe a SOL-only bonding curve, and
`@nirholas/pump-sdk` agrees — no quote mint on `BondingCurve`, none in
`createV2Instruction`. Yet the same SDK derives `bonding-curve-v2` and `pool-v2`
PDAs it neither decodes nor builds for, and Custom Pairs shipped in September
2026.

The working hypothesis is that Custom Pairs live in that v2 account family. It
is a hypothesis, so it is gated behind `NEXT_PUBLIC_ENABLE_PUMP_CUSTOM_PAIR` and
`is_custom_pair` is stored three-state. Guessing the offset wrong does not
throw — 32 bytes of padding decode to a well-formed address — it just makes
every stock-paired pump coin quietly wrong. StonkFun needs none of this and is
the primary path.
