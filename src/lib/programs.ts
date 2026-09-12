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
 * What is *not* established about pump.fun Custom Pairs.
 *
 * pump.fun's published program README documents a SOL-only bonding curve, and
 * `@nirholas/pump-sdk@1.36.0` agrees: its `BondingCurve` interface carries no
 * quote mint, and `createV2Instruction` takes no quote mint argument. Yet the
 * same SDK derives `bonding-curve-v2` and `pool-v2` PDAs it neither decodes nor
 * builds for, and Custom Pairs shipped in September 2026.
 *
 * The likely explanation is that Custom Pairs live in that v2 account family,
 * because appending a field to a live Anchor account would break every decoder
 * in the ecosystem. That is a reading of the evidence, not a fact.
 *
 * Guessing wrong here is expensive precisely because it is quiet. Read 32 bytes
 * at an offset that is actually padding and every Custom Pair either reports as
 * SOL-quoted — mispricing the coin by the whole SOL/stock ratio and dropping it
 * out of the universe test — or a SOL-quoted coin acquires a quote mint made of
 * arbitrary bytes. Neither throws. Both just make the numbers wrong.
 *
 * So the flag defaults off, `is_custom_pair` is stored three-state, and
 * `npm run probe:pump` against a real Custom Pair coin is what moves anything
 * out of here.
 */
export const UNVERIFIED = {
  pumpCustomPairs: {
    hypothesis:
      "Custom Pairs use the bonding-curve-v2 / pool-v2 account family, with the " +
      "quote mint stored on the v2 curve account.",
    verifyWith: "npm run probe:pump -- <mint of a known Custom Pair coin>",
    enabled: process.env.NEXT_PUBLIC_ENABLE_PUMP_CUSTOM_PAIR === "1",
  },
} as const;

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
