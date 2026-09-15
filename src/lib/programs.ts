/**
 * Every program, platform config and layout offset Trador reads.
 *
 * One file, because the alternative is what the EVM version of this app grew
 * into: the same factory address duplicated across five modules, each with a
 * comment asking the next person to keep them in sync. When one of them drifted,
 * the feed emptied and the cause took a day to find.
 *
 * Two rules for anything added here:
 *
 *   1. A program id or config is only real once it has been read off mainnet.
 *      `npm run probe:accounts` does that and prints what it found. An id that
 *      has not been through it belongs in `UNVERIFIED`, not next to the rest.
 *   2. Attribution never comes from a token's name, symbol, or a third-party
 *      listing. It comes from program-owned account state. Several launchpads
 *      run near-identical programs and anyone can name a token anything.
 */

import {type Pubkey, assertPubkey} from "./pubkey";

/** Assert at module load, so a typo is a boot failure and not a silent miss. */
const id = (value: string): Pubkey => assertPubkey(value, "program id");

// ---------------------------------------------------------------------------
// Core Solana
// ---------------------------------------------------------------------------

export const SYSTEM_PROGRAM = id("11111111111111111111111111111111");
export const TOKEN_PROGRAM = id("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM = id("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM = id("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const MEMO_PROGRAM = id("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Wrapped SOL. Note the trailing `2` — `So111…111` is the System Program. */
export const WSOL_MINT = id("So11111111111111111111111111111111111111112");
export const USDC_MINT = id("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// ---------------------------------------------------------------------------
// Raydium — where StonkFun launches live
// ---------------------------------------------------------------------------

/**
 * Raydium LaunchLab. StonkFun does not run its own program; it runs on
 * LaunchLab under its own platform config, which is what makes attribution
 * possible at all: a launch is StonkFun's because its pool says so, not because
 * a website listed it.
 */
export const RAYDIUM_LAUNCHPAD = id("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");

/** Bonding curves graduate here. */
export const RAYDIUM_CPMM = id("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
export const RAYDIUM_CLMM = id("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

// ---------------------------------------------------------------------------
// StonkFun
// ---------------------------------------------------------------------------

export type StonkfunConfigKind = "rewards" | "standard";

export interface StonkfunPlatform {
  readonly kind: StonkfunConfigKind;
  readonly platformId: Pubkey;
  /**
   * Whether launches under this config route a share of every trade to holders,
   * paid in the quote asset. This is the second arm of the universe test: a
   * coin quoted in SOL still belongs in Trador if it pays its holders in stock.
   */
  readonly paysHolders: boolean;
}

export const STONKFUN_PLATFORMS: readonly StonkfunPlatform[] = [
  {
    kind: "rewards",
    platformId: id("6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt"),
    paysHolders: true,
  },
  {
    kind: "standard",
    platformId: id("4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7"),
    paysHolders: false,
  },
];

export const STONKFUN_PLATFORM_IDS: readonly Pubkey[] = STONKFUN_PLATFORMS.map(
  (platform) => platform.platformId,
);

/** The wallet StonkFun's own deployments are signed by. */
export const STONKFUN_LAUNCHER = id("5CEbueQnq1Ym2uSSx2xXds3jQAqT1BDnkA59RZobSPAG");

export function stonkfunPlatformFor(platformId: string): StonkfunPlatform | null {
  return STONKFUN_PLATFORMS.find((platform) => platform.platformId === platformId) ?? null;
}

// ---------------------------------------------------------------------------
// pump.fun
// ---------------------------------------------------------------------------

export const PUMP_PROGRAM = id("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_GLOBAL = id("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
export const PUMP_AMM = id("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
export const PUMP_FEES = id("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

/** PDA seeds. The v2 pair is the unverified Custom Pairs path — see below. */
export const PUMP_SEEDS = {
  global: "global",
  bondingCurve: "bonding-curve",
  bondingCurveV2: "bonding-curve-v2",
  pool: "pool",
  poolV2: "pool-v2",
} as const;

/**
 * PumpSwap's `Pool` account — where pump.fun Custom Pairs actually live.
 *
 * This was the project's biggest unknown and the answer turned out to be a
 * layer up from where everyone looks. pump.fun's `BondingCurve` genuinely has
 * no quote mint — confirmed against the IDL bundled with `@nirholas/pump-sdk`,
 * whose fields are just the four reserves, `token_total_supply`, `complete`,
 * `creator`, `is_mayhem_mode`, `is_cashback_coin` — and neither `create` nor
 * `create_v2` accepts one. The bonding curve is SOL-only and always has been.
 *
 * Custom Pairs are an **AMM** feature. PumpSwap's `Pool` carries `base_mint`
 * and `quote_mint` side by side, and `create_pool` takes both, so a coin priced
 * in NVDAx is a PumpSwap pool whose quote mint is the stock.
 *
 * Offsets derived from the IDL and then confirmed on mainnet: a `memcmp` for
 * WSOL at offset 75 returns 146,685 pools, and the same filter for a stock mint
 * returns real stock-quoted pools whose `base_mint` is a pump.fun coin.
 *
 * **Two sizes are live and both matter.** 301 is current (142,317 pools) and
 * 245 is legacy (4,368). Fields were appended rather than inserted, so every
 * offset below is valid for both — which is exactly why this must not be
 * filtered by `dataSize`. Pinning 245 would have found the 4,368 oldest pools
 * and silently missed 97% of the program, including every Custom Pair.
 */
export const PUMPSWAP_POOL = {
  /** Current account size. Legacy pools are 245; offsets are shared. */
  SPAN: 301,
  LEGACY_SPAN: 245,
  POOL_BUMP: 8,
  INDEX: 9,
  CREATOR: 11,
  BASE_MINT: 43,
  QUOTE_MINT: 75,
  LP_MINT: 107,
  BASE_TOKEN_ACCOUNT: 139,
  QUOTE_TOKEN_ACCOUNT: 171,
  LP_SUPPLY: 203,
  COIN_CREATOR: 211,
} as const;

/**
 * Find pump.fun pools priced against one mint.
 *
 * No `dataSize` filter, deliberately — see the note above. The quote-mint
 * memcmp alone is both correct and highly selective.
 */
export function pumpPoolFilters(quoteMint: Pubkey) {
  return [{memcmp: {offset: PUMPSWAP_POOL.QUOTE_MINT, bytes: quoteMint}}];
}

// ---------------------------------------------------------------------------
// LaunchpadPool layout
// ---------------------------------------------------------------------------

/**
 * Byte offsets into Raydium's `LaunchpadPool` account.
 *
 * Derived from `raydium-sdk-V2/src/raydium/launchpad/layout.ts`, which means
 * they are computed rather than observed. They rest on `VestingSchedule` being
 * exactly five u64s, and on the published alpha layout matching the deployed
 * program. If either assumption is off, every offset past 101 shifts and the
 * whole universe mis-attributes — which surfaces as an empty feed, not an error.
 *
 * `test/launchlab-layout.test.ts` pins them against a real mainnet account, and
 * `SPAN` is the cheap canary: a layout change almost always changes the size.
 */
export const LAUNCHPAD_POOL = {
  SPAN: 429,
  STATUS: 17,
  VIRTUAL_A: 37,
  VIRTUAL_B: 45,
  /**
   * Quote raised so far, and the target that triggers migration.
   *
   * Found by diffing pools across states rather than from a published layout:
   * on every graduated pool these two are equal to within a few base units,
   * and on every curve pool the first is a small fraction of the second. A
   * SOL-quoted pool's target reads exactly 85_000_000_000 — 85 SOL, the
   * classic LaunchLab threshold — which is what confirmed the reading.
   *
   * Their ratio is the only progress number comparable across coins priced in
   * different stocks, because the target is denominated in the quote asset and
   * every stock has its own config.
   */
  REAL_QUOTE: 61,
  FUND_RAISING_TARGET: 69,
  CONFIG_ID: 141,
  PLATFORM_ID: 173,
  MINT_A: 205,
  MINT_B: 237,
  CREATOR: 333,
} as const;

/**
 * `getProgramAccounts` on LaunchLab unfiltered would return every pool on
 * Solana. These two filters cut it to one platform's launches server-side, so
 * the reconciler costs two calls instead of a timeout.
 */
export function stonkfunPoolFilters(platformId: Pubkey) {
  return [
    {dataSize: LAUNCHPAD_POOL.SPAN},
    {memcmp: {offset: LAUNCHPAD_POOL.PLATFORM_ID, bytes: platformId}},
  ];
}

// ---------------------------------------------------------------------------
// Launchpads, as the app names them
// ---------------------------------------------------------------------------

export type LaunchpadId = "stonkfun" | "pumpfun";

export const LAUNCHPADS: Record<
  LaunchpadId,
  {label: string; url: string; program: Pubkey}
> = {
  stonkfun: {
    label: "StonkFun",
    url: "https://stonkfun.xyz",
    program: RAYDIUM_LAUNCHPAD,
  },
  pumpfun: {
    label: "pump.fun",
    url: "https://pump.fun",
    program: PUMP_PROGRAM,
  },
};

/** Every program the indexer subscribes to. */
export const INDEXED_PROGRAMS: readonly Pubkey[] = [
  RAYDIUM_LAUNCHPAD,
  PUMP_PROGRAM,
];
